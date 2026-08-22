package repositories

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (store *PostgresStore) Ping(ctx context.Context) error {
	return store.pool.Ping(ctx)
}

// Apply is the only method in this service that writes. The inbox row and the
// projection commit together, so "we have seen this message" can never be true
// while "we applied it" is false.
func (store *PostgresStore) Apply(ctx context.Context, projection models.Projection) (bool, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer transaction.Rollback(ctx)

	commandTag, err := transaction.Exec(ctx, `INSERT INTO inbox_messages (message_id, subject, job_id)
		VALUES ($1,$2,$3) ON CONFLICT (message_id) DO NOTHING`,
		projection.Message.MessageID, projection.Message.Subject, projection.Message.JobID)
	if err != nil {
		return false, err
	}
	if commandTag.RowsAffected() == 0 {
		// Already applied. Commit the empty transaction rather than rolling
		// back so the caller's ack path stays identical either way.
		return false, transaction.Commit(ctx)
	}

	if projection.Job != nil {
		if err := upsertJobProjection(ctx, transaction, *projection.Job); err != nil {
			return false, err
		}
	}
	if projection.Snapshot != nil {
		if err := upsertWorldProjection(ctx, transaction, *projection.Snapshot); err != nil {
			return false, err
		}
	}
	if projection.ServiceStart != nil {
		if err := insertServiceStart(ctx, transaction, *projection.ServiceStart); err != nil {
			return false, err
		}
	}
	return true, transaction.Commit(ctx)
}

// insertServiceStart is an insert and never an upsert. A boot happened once
// and its facts do not change, so a second row with the same instance id
// could only come from a redelivery - which the inbox above has already
// stopped. DO NOTHING is belt to that braces, not a merge.
func insertServiceStart(ctx context.Context, transaction pgx.Tx, start models.ServiceStart) error {
	_, err := transaction.Exec(ctx, `INSERT INTO service_starts
		(instance_id, service, version, boot_duration_ms, started_at)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (instance_id) DO NOTHING`,
		start.InstanceID, start.Service, start.Version, start.BootDurationMS, start.StartedAt)
	return err
}

// RecordOwnStart is how analytics-service announces itself, and the one place
// this database is written outside a projection.
//
// It writes directly instead of publishing, because it is the consumer: the
// event would travel to itself and back for no gain, and sending it would
// require an exception in the one NATS user that is permitted to publish no
// myunivokai subject at all. Keeping that absolute intact is worth more than
// making all six services look identical here.
func (store *PostgresStore) RecordOwnStart(ctx context.Context, start models.ServiceStart) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	if err := insertServiceStart(ctx, transaction, start); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

// upsertJobProjection is monotonic in two directions at once, because
// JetStream may deliver a job's events out of order:
//
//   - created_at only ever moves earlier (LEAST), so a late-arriving first
//     event still produces the right duration.
//   - a job that already reached a terminal status never regresses to
//     `processing` because a duplicate dna.generated turned up afterwards.
func upsertJobProjection(ctx context.Context, transaction pgx.Tx, job models.JobEvent) error {
	// A nil *time.Time, not a nil any: pgx resolves an encode plan from the
	// static type, and `(*interface{})(nil)` has no plan for timestamptz.
	var completedAt *time.Time
	if job.Terminal {
		occurredAt := job.OccurredAt
		completedAt = &occurredAt
	}
	if _, err := transaction.Exec(ctx, `INSERT INTO job_projections
			(job_id, family, status, error_code, error_message, world_id, profile_id, dna_version_id, created_at, completed_at)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,NULLIF($8,'')::uuid,$9,$10)
		ON CONFLICT (job_id) DO UPDATE SET
			family = CASE WHEN EXCLUDED.family <> '' THEN EXCLUDED.family ELSE job_projections.family END,
			status = CASE WHEN job_projections.status IN ('completed','failed') THEN job_projections.status ELSE EXCLUDED.status END,
			error_code = CASE WHEN EXCLUDED.error_code <> '' THEN EXCLUDED.error_code ELSE job_projections.error_code END,
			error_message = CASE WHEN EXCLUDED.error_message <> '' THEN EXCLUDED.error_message ELSE job_projections.error_message END,
			world_id = COALESCE(EXCLUDED.world_id, job_projections.world_id),
			profile_id = COALESCE(EXCLUDED.profile_id, job_projections.profile_id),
			dna_version_id = COALESCE(EXCLUDED.dna_version_id, job_projections.dna_version_id),
			created_at = LEAST(job_projections.created_at, EXCLUDED.created_at),
			completed_at = COALESCE(job_projections.completed_at, EXCLUDED.completed_at),
			projected_at = NOW()`,
		job.JobID, string(job.Family), string(job.Status), job.ErrorCode, job.ErrorMessage,
		job.WorldID, job.ProfileID, job.DNAVersionID, job.OccurredAt, completedAt,
	); err != nil {
		return err
	}
	// duration_ms is derived from the row's own final timestamps rather than
	// computed in the statement above, because ON CONFLICT cannot read the
	// post-update value of a sibling column it just wrote.
	_, err := transaction.Exec(ctx, `UPDATE job_projections
		SET duration_ms = GREATEST((EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)::INTEGER, 0)
		WHERE job_id = $1 AND completed_at IS NOT NULL`, job.JobID)
	return err
}

// upsertWorldProjection moves a world forward and never backward. The
// revision guard in the WHERE clause is what makes duplicate and out-of-order
// delivery harmless without the consumer having to order anything itself —
// the reason the design chose snapshot events over fine-grained ones.
func upsertWorldProjection(ctx context.Context, transaction pgx.Tx, snapshot contracts.WorldSnapshot) error {
	favoriteColors, err := json.Marshal(snapshot.FavoriteColors)
	if err != nil {
		return err
	}
	commandTag, err := transaction.Exec(ctx, `INSERT INTO world_projections
			(world_id, family, profile_id, dna_version_id, source_job_id, revision, nickname, role,
			 archetype, scene_name, mood, world_style, favorite_colors,
			 trait_creativity, trait_discipline, trait_curiosity, trait_energy, trait_focus,
			 variant_count, selected_variant_no, variant_seed, is_published, published_at, world_created_at)
		VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
		ON CONFLICT (world_id) DO UPDATE SET
			family = EXCLUDED.family,
			profile_id = EXCLUDED.profile_id,
			dna_version_id = EXCLUDED.dna_version_id,
			source_job_id = EXCLUDED.source_job_id,
			revision = EXCLUDED.revision,
			nickname = EXCLUDED.nickname,
			role = EXCLUDED.role,
			archetype = EXCLUDED.archetype,
			scene_name = EXCLUDED.scene_name,
			mood = EXCLUDED.mood,
			world_style = EXCLUDED.world_style,
			favorite_colors = EXCLUDED.favorite_colors,
			trait_creativity = EXCLUDED.trait_creativity,
			trait_discipline = EXCLUDED.trait_discipline,
			trait_curiosity = EXCLUDED.trait_curiosity,
			trait_energy = EXCLUDED.trait_energy,
			trait_focus = EXCLUDED.trait_focus,
			variant_count = EXCLUDED.variant_count,
			selected_variant_no = EXCLUDED.selected_variant_no,
			variant_seed = EXCLUDED.variant_seed,
			is_published = EXCLUDED.is_published,
			published_at = EXCLUDED.published_at,
			world_created_at = EXCLUDED.world_created_at,
			projected_at = NOW()
		WHERE world_projections.revision < EXCLUDED.revision`,
		snapshot.WorldID, string(snapshot.Family), snapshot.ProfileID, snapshot.DNAVersionID, snapshot.SourceJobID,
		snapshot.Revision, snapshot.Nickname, snapshot.Role, snapshot.Archetype, snapshot.SceneName,
		snapshot.Mood, snapshot.WorldStyle, favoriteColors,
		snapshot.TraitScores.Creativity, snapshot.TraitScores.Discipline, snapshot.TraitScores.Curiosity,
		snapshot.TraitScores.Energy, snapshot.TraitScores.Focus,
		snapshot.VariantCount, snapshot.SelectedVariantNo, snapshot.VariantSeed,
		snapshot.PublishedAt != nil, snapshot.PublishedAt,
		snapshot.WorldCreatedAt,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		// The stored projection is at the same revision or newer, so its rolls
		// were derived from a seed at least as current as this one's. Rewriting
		// them from an older snapshot would move a world's lottery backwards —
		// the exact thing the revision guard above exists to prevent.
		return nil
	}
	return replaceRareRolls(ctx, transaction, snapshot)
}

// replaceRareRolls stores what every lottery this world entered actually drew.
//
// Delete-then-insert rather than an upsert: selecting a different variant
// changes the seed and therefore every draw, and a feature can leave the
// catalogue. A row surviving from a previous seed would keep being counted as
// this world's draw, and nothing would ever notice — it would simply be a
// plausible number.
//
// The draws are computed here, at projection time, rather than at query time,
// because the query needs to FILTER on them: the rarity panel's counts are
// clickable, and "the worlds behind this number" has to be a keyset-paged SQL
// predicate, not a slice of rows re-derived in Go after the fact.
func replaceRareRolls(ctx context.Context, transaction pgx.Tx, snapshot contracts.WorldSnapshot) error {
	if _, err := transaction.Exec(ctx, `DELETE FROM world_rare_rolls WHERE world_id = $1::uuid`, snapshot.WorldID); err != nil {
		return err
	}
	// Empty for a world with no seed, which is every world projected before the
	// seed crossed the data boundary. Those stay absent from this table rather
	// than being written as zero draws, so the panel can count them as
	// unmeasured instead of reporting them as misses.
	for _, roll := range contracts.RarityRollsFor(snapshot.Family, snapshot.VariantSeed) {
		if _, err := transaction.Exec(ctx, `INSERT INTO world_rare_rolls (world_id, feature_key, roll, species_roll)
			VALUES ($1::uuid,$2,$3,$4)`, snapshot.WorldID, roll.Feature, roll.Roll, roll.SpeciesRoll); err != nil {
			return err
		}
	}
	return nil
}
