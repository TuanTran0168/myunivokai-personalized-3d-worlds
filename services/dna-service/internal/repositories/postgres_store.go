package repositories

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
)

const (
	postgresUniqueViolationCode = "23505"
	dnaVersionNumberOne         = 1
	composeMessageIDSuffix      = ":compose"
	dnaGeneratedMessageSuffix   = ":dna-generated"
	dnaFailedMessageSuffix      = ":dna-failed"
	// The family claim messages are keyed on the claim's own correlation id
	// and the family, NOT on the anonymous id. A JetStream redelivery carries
	// the same correlation id and so dedupes; a genuinely new claim request
	// gets a new one and so is not swallowed by ON CONFLICT DO NOTHING — which
	// matters because a browser that failed to clear its anonymous cookie can
	// legitimately claim the same anonymous id twice, for worlds it made in
	// between.
	familyClaimMessageIDFormat = "%s:%s-claim"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (store *PostgresStore) EnsureJob(ctx context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) (JobRecord, error) {
	existingRecord, err := store.getJobRecord(ctx, envelope.JobID)
	if err == nil {
		return existingRecord, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return JobRecord{}, err
	}
	inputJSON, err := json.Marshal(envelope.Data.Input.Normalize())
	if err != nil {
		return JobRecord{}, fmt.Errorf("marshal profile input: %w", err)
	}
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return JobRecord{}, err
	}
	defer transaction.Rollback(ctx)
	var profileID string
	// The owner comes from the command the gateway published, which set it
	// from a verified token. It is written here, on the profile, before any
	// family service hears about the world - so a create that crashes between
	// the two still has an owner recorded where the claim looks for it.
	if err := transaction.QueryRow(ctx, `INSERT INTO profiles (raw_input, owner_account_id, anonymous_id) VALUES ($1,$2,$3) RETURNING id::text`,
		inputJSON, envelope.Data.OwnerAccountID, envelope.Data.AnonymousID).Scan(&profileID); err != nil {
		return JobRecord{}, err
	}
	job := contracts.Job{JobID: envelope.JobID, Family: envelope.Data.Family, Status: contracts.JobStatusQueued, ProfileID: profileID}
	if err := transaction.QueryRow(ctx, `INSERT INTO generation_jobs (job_id, family, profile_id, status)
		VALUES ($1,$2,$3,$4)
		RETURNING created_at, updated_at`, job.JobID, job.Family, job.ProfileID, job.Status).Scan(&job.CreatedAt, &job.UpdatedAt); err != nil {
		if isUniqueViolation(err) {
			_ = transaction.Rollback(ctx)
			return store.getJobRecord(ctx, envelope.JobID)
		}
		return JobRecord{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return JobRecord{}, err
	}
	return JobRecord{Job: job, Input: envelope.Data.Input.Normalize(), Created: true}, nil
}

func (store *PostgresStore) MarkJobProcessing(ctx context.Context, jobID string) error {
	commandTag, err := store.pool.Exec(ctx, `UPDATE generation_jobs SET status='processing', updated_at=NOW()
		WHERE job_id=$1 AND status IN ('queued','processing')`, jobID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		job, getError := store.GetJob(ctx, jobID)
		if getError != nil {
			return getError
		}
		if job.Status == contracts.JobStatusCompleted || job.Status == contracts.JobStatusFailed {
			return nil
		}
		return ErrNotFound
	}
	return nil
}

func (store *PostgresStore) StoreDNAAndQueueComposition(ctx context.Context, jobID string, input contracts.WorldInput, profileDNA contracts.ProfileDNA, attempts []ai.Attempt) (contracts.Job, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return contracts.Job{}, err
	}
	defer transaction.Rollback(ctx)
	job, err := getJobWithExecutor(ctx, transaction, jobID, true)
	if err != nil {
		return contracts.Job{}, err
	}
	if job.DNAVersionID != "" {
		return job, transaction.Commit(ctx)
	}
	profileDNAJSON, err := json.Marshal(profileDNA)
	if err != nil {
		return contracts.Job{}, fmt.Errorf("marshal profile dna: %w", err)
	}
	var dnaVersionID string
	if err := transaction.QueryRow(ctx, `INSERT INTO dna_versions (profile_id, source_job_id, version_number, profile_dna)
		VALUES ($1,$2,$3,$4) RETURNING id::text`, job.ProfileID, jobID, dnaVersionNumberOne, profileDNAJSON).Scan(&dnaVersionID); err != nil {
		return contracts.Job{}, err
	}
	job.DNAVersionID = dnaVersionID
	job.Status = contracts.JobStatusProcessing
	if _, err := transaction.Exec(ctx, `UPDATE generation_jobs SET dna_version_id=$2, status='processing', updated_at=NOW() WHERE job_id=$1`, jobID, dnaVersionID); err != nil {
		return contracts.Job{}, err
	}
	if err := insertAttempts(ctx, transaction, jobID, attempts); err != nil {
		return contracts.Job{}, err
	}
	composeSubject, err := job.Family.ComposeCommandSubject()
	if err != nil {
		return contracts.Job{}, err
	}
	// Read from the profile row rather than carried in memory from the generate
	// command: this method runs on a JetStream redelivery too, and a world
	// composed on the second attempt has to end up owned by the same account as
	// one composed on the first.
	//
	// Both identity fields, and reading them together is what keeps the
	// invariant true downstream: a claim that lands between the generate and
	// the compose has already set the owner and cleared the anonymous id on
	// this very row, so the compose command carries the claimed owner rather
	// than an anonymous id nobody holds any more.
	var ownerAccountID *string
	var anonymousID *string
	if err := transaction.QueryRow(ctx, `SELECT owner_account_id::text, anonymous_id::text FROM profiles WHERE id = $1`,
		job.ProfileID).Scan(&ownerAccountID, &anonymousID); err != nil {
		return contracts.Job{}, err
	}
	composeEnvelope := contracts.NewEnvelope(jobID, contracts.ComposeWorldData{
		Family:         job.Family,
		ProfileID:      job.ProfileID,
		DNAVersionID:   dnaVersionID,
		Profile:        contracts.ProfileSummary{Nickname: input.Nickname, Role: input.Role},
		VisualIntent:   contracts.VisualIntent{Mood: input.Mood, FavoriteColors: input.FavoriteColors, PreferredWorldStyle: input.PreferredWorldStyle},
		ProfileDNA:     profileDNA,
		OwnerAccountID: ownerAccountID,
		AnonymousID:    anonymousID,
	})
	dnaGeneratedEnvelope := contracts.NewEnvelope(jobID, contracts.DNAGeneratedData{Family: job.Family, ProfileID: job.ProfileID, DNAVersionID: dnaVersionID})
	if err := insertOutbox(ctx, transaction, jobID+composeMessageIDSuffix, composeSubject, composeEnvelope); err != nil {
		return contracts.Job{}, err
	}
	if err := insertOutbox(ctx, transaction, jobID+dnaGeneratedMessageSuffix, contracts.DNAGeneratedEventSubject, dnaGeneratedEnvelope); err != nil {
		return contracts.Job{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return contracts.Job{}, err
	}
	return store.GetJob(ctx, jobID)
}

// ClaimWorlds gives one account every profile an anonymous visitor made, and
// stages one command per family that visitor actually used.
//
// The fan-out narrows here and nowhere else, because this is the only service
// that knows which families were used: `generation_jobs` names one per job. A
// visitor who only ever made a forest costs one woken service instead of three.
//
// Two plain statements in one transaction rather than a data-modifying CTE or
// an array parameter, for the reason the deletion in each family service gives:
// there is no Postgres in CI, so the SQL that ships is the SQL somebody has to
// be able to check by reading it.
func (store *PostgresStore) ClaimWorlds(ctx context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) (ClaimResult, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return ClaimResult{}, err
	}
	defer transaction.Rollback(ctx)
	// The families are read BEFORE the update, while anonymous_id still points
	// at these rows. Afterwards it is NULL and there is nothing left to join
	// on - and finding them by their new owner instead would also pick up
	// profiles claimed by an earlier claim of a different anonymous id, which
	// is exactly the blind fan-out this narrowing exists to avoid.
	familyRows, err := transaction.Query(ctx, `SELECT DISTINCT generation_jobs.family
		FROM generation_jobs
		JOIN profiles ON profiles.id = generation_jobs.profile_id
		WHERE profiles.anonymous_id = $1 AND profiles.owner_account_id IS NULL`, envelope.Data.AnonymousID)
	if err != nil {
		return ClaimResult{}, err
	}
	var families []contracts.WorldFamily
	for familyRows.Next() {
		var family contracts.WorldFamily
		if err := familyRows.Scan(&family); err != nil {
			familyRows.Close()
			return ClaimResult{}, err
		}
		families = append(families, family)
	}
	familyRows.Close()
	if err := familyRows.Err(); err != nil {
		return ClaimResult{}, err
	}
	// `owner_account_id IS NULL` is the whole of the idempotency, and of the
	// two-device race: the second claim of one anonymous id updates zero rows.
	// A world is claimable exactly once, for ever.
	commandTag, err := transaction.Exec(ctx, `UPDATE profiles SET owner_account_id = $1, anonymous_id = NULL, updated_at = NOW()
		WHERE anonymous_id = $2 AND owner_account_id IS NULL`, envelope.Data.AccountID, envelope.Data.AnonymousID)
	if err != nil {
		return ClaimResult{}, err
	}
	claimedProfileCount := commandTag.RowsAffected()
	// Claimed nothing, so tell nobody. This is the concurrent loser's path:
	// it read the families a moment before the winner's update took the rows,
	// and staging a fan-out here would send three services a command that can
	// only update zero rows. The family services would refuse it correctly,
	// which is precisely why the mistake would never be noticed.
	if claimedProfileCount == 0 {
		if err := transaction.Commit(ctx); err != nil {
			return ClaimResult{}, err
		}
		return ClaimResult{}, nil
	}
	for _, family := range families {
		claimSubject, subjectError := family.ClaimCommandSubject()
		if subjectError != nil {
			return ClaimResult{}, subjectError
		}
		messageID := fmt.Sprintf(familyClaimMessageIDFormat, envelope.JobID, family)
		if err := insertOutbox(ctx, transaction, messageID, claimSubject, envelope); err != nil {
			return ClaimResult{}, err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return ClaimResult{}, err
	}
	return ClaimResult{ClaimedProfileCount: claimedProfileCount, NotifiedFamilies: families}, nil
}

func (store *PostgresStore) FailDNAJob(ctx context.Context, jobID string, family contracts.WorldFamily, code, message string, attempts []ai.Attempt) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	if _, err := transaction.Exec(ctx, `UPDATE generation_jobs SET status='failed', error_code=$2, error_message=$3,
		updated_at=NOW(), completed_at=NOW() WHERE job_id=$1 AND status <> 'completed'`, jobID, code, message); err != nil {
		return err
	}
	if err := insertAttempts(ctx, transaction, jobID, attempts); err != nil {
		return err
	}
	failedEnvelope := contracts.NewEnvelope(jobID, contracts.DNAFailedData{Family: family, Code: code, Message: message})
	if err := insertOutbox(ctx, transaction, jobID+dnaFailedMessageSuffix, contracts.DNAFailedEventSubject, failedEnvelope); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func (store *PostgresStore) ApplyFamilyCompleted(ctx context.Context, messageID, subject string, envelope contracts.Envelope[contracts.FamilyCompletedData]) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	inserted, err := insertInbox(ctx, transaction, messageID, subject, envelope.JobID)
	if err != nil || !inserted {
		if err != nil {
			return err
		}
		return transaction.Commit(ctx)
	}
	commandTag, err := transaction.Exec(ctx, `UPDATE generation_jobs SET status='completed', world_id=$2,
		error_code=NULL, error_message=NULL, updated_at=NOW(), completed_at=NOW() WHERE job_id=$1`, envelope.JobID, envelope.Data.WorldID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return transaction.Commit(ctx)
}

func (store *PostgresStore) ApplyFamilyFailed(ctx context.Context, messageID, subject string, envelope contracts.Envelope[contracts.FamilyFailedData]) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	inserted, err := insertInbox(ctx, transaction, messageID, subject, envelope.JobID)
	if err != nil || !inserted {
		if err != nil {
			return err
		}
		return transaction.Commit(ctx)
	}
	commandTag, err := transaction.Exec(ctx, `UPDATE generation_jobs SET status='failed', error_code=$2,
		error_message=$3, updated_at=NOW(), completed_at=NOW() WHERE job_id=$1 AND status <> 'completed'`, envelope.JobID, envelope.Data.Code, envelope.Data.Message)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return transaction.Commit(ctx)
}

func (store *PostgresStore) GetJob(ctx context.Context, jobID string) (contracts.Job, error) {
	return getJobWithExecutor(ctx, store.pool, jobID, false)
}

func (store *PostgresStore) getJobRecord(ctx context.Context, jobID string) (JobRecord, error) {
	row := store.pool.QueryRow(ctx, `SELECT j.job_id, j.family, j.status, j.profile_id::text,
		COALESCE(j.dna_version_id::text,''), COALESCE(j.world_id::text,''), COALESCE(j.error_code,''),
		COALESCE(j.error_message,''), j.created_at, j.updated_at, p.raw_input
		FROM generation_jobs j JOIN profiles p ON p.id=j.profile_id WHERE j.job_id=$1`, jobID)
	job, input, err := scanJobRecord(row)
	if err != nil {
		return JobRecord{}, mapNotFound(err)
	}
	return JobRecord{Job: job, Input: input}, nil
}

func (store *PostgresStore) PendingOutbox(ctx context.Context, maximumMessages int) ([]OutboxMessage, error) {
	rows, err := store.pool.Query(ctx, `SELECT id::text, message_id, subject, payload FROM outbox_messages
		WHERE published_at IS NULL ORDER BY created_at LIMIT $1`, maximumMessages)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]OutboxMessage, 0, maximumMessages)
	for rows.Next() {
		var message OutboxMessage
		if err := rows.Scan(&message.ID, &message.MessageID, &message.Subject, &message.Payload); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (store *PostgresStore) MarkOutboxPublished(ctx context.Context, outboxID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE outbox_messages SET published_at=NOW() WHERE id=$1`, outboxID)
	return err
}

func (store *PostgresStore) Ping(ctx context.Context) error {
	return store.pool.Ping(ctx)
}

type rowScanner interface {
	Scan(...any) error
}

type queryExecutor interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getJobWithExecutor(ctx context.Context, executor queryExecutor, jobID string, forUpdate bool) (contracts.Job, error) {
	lockingClause := ""
	if forUpdate {
		lockingClause = " FOR UPDATE"
	}
	row := executor.QueryRow(ctx, `SELECT job_id, family, status, profile_id::text,
		COALESCE(dna_version_id::text,''), COALESCE(world_id::text,''), COALESCE(error_code,''),
		COALESCE(error_message,''), created_at, updated_at FROM generation_jobs WHERE job_id=$1`+lockingClause, jobID)
	job, err := scanJob(row)
	return job, mapNotFound(err)
}

func scanJob(scanner rowScanner) (contracts.Job, error) {
	var job contracts.Job
	var errorCode, errorMessage string
	if err := scanner.Scan(&job.JobID, &job.Family, &job.Status, &job.ProfileID, &job.DNAVersionID, &job.WorldID, &errorCode, &errorMessage, &job.CreatedAt, &job.UpdatedAt); err != nil {
		return contracts.Job{}, err
	}
	if errorCode != "" {
		job.Error = &contracts.RPCError{Code: errorCode, Message: errorMessage}
	}
	return job, nil
}

func scanJobRecord(scanner rowScanner) (contracts.Job, contracts.WorldInput, error) {
	var job contracts.Job
	var errorCode, errorMessage string
	var inputJSON []byte
	if err := scanner.Scan(&job.JobID, &job.Family, &job.Status, &job.ProfileID, &job.DNAVersionID, &job.WorldID, &errorCode, &errorMessage, &job.CreatedAt, &job.UpdatedAt, &inputJSON); err != nil {
		return contracts.Job{}, contracts.WorldInput{}, err
	}
	if errorCode != "" {
		job.Error = &contracts.RPCError{Code: errorCode, Message: errorMessage}
	}
	var input contracts.WorldInput
	if err := json.Unmarshal(inputJSON, &input); err != nil {
		return contracts.Job{}, contracts.WorldInput{}, fmt.Errorf("decode profile input: %w", err)
	}
	return job, input, nil
}

func insertAttempts(ctx context.Context, transaction pgx.Tx, jobID string, attempts []ai.Attempt) error {
	for _, attempt := range attempts {
		usageJSON, err := json.Marshal(attempt.Usage)
		if err != nil {
			return err
		}
		if _, err := transaction.Exec(ctx, `INSERT INTO ai_generation_attempts
			(job_id, provider, model, task, prompt_version, input_hash, request_json, response_json, usage_json, latency_ms, status, error)
			VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11)`,
			jobID, attempt.Provider, attempt.Model, attempt.Task, attempt.PromptVersion, attempt.InputHash,
			nullableJSON(attempt.Response), nullableJSON(usageJSON), attempt.Latency.Milliseconds(), attempt.Status, nullableString(attempt.Error)); err != nil {
			return err
		}
	}
	return nil
}

func insertOutbox(ctx context.Context, transaction pgx.Tx, messageID, subject string, envelope any) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	_, err = transaction.Exec(ctx, `INSERT INTO outbox_messages (message_id, subject, payload)
		VALUES ($1,$2,$3) ON CONFLICT (message_id) DO NOTHING`, messageID, subject, payload)
	return err
}

func insertInbox(ctx context.Context, transaction pgx.Tx, messageID, subject, jobID string) (bool, error) {
	commandTag, err := transaction.Exec(ctx, `INSERT INTO inbox_messages (message_id, subject, job_id)
		VALUES ($1,$2,$3) ON CONFLICT (message_id) DO NOTHING`, messageID, subject, jobID)
	return commandTag.RowsAffected() == 1, err
}

func nullableJSON(value []byte) any {
	if len(value) == 0 || string(value) == "{}" {
		return nil
	}
	return value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func mapNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == postgresUniqueViolationCode
}
