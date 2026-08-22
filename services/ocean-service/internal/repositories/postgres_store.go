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
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

const (
	composeInboxMessageSuffix    = ":compose"
	completedOutboxMessageSuffix = ":ocean-completed"
	postgresUniqueViolationCode  = "23505"
	postgresForeignKeyCode       = "23503"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (store *PostgresStore) CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant) (WorldBundle, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return WorldBundle{}, err
	}
	defer transaction.Rollback(ctx)
	commandTag, err := transaction.Exec(ctx, `INSERT INTO inbox_messages (message_id, subject, job_id)
		VALUES ($1,$2,$3) ON CONFLICT (message_id) DO NOTHING`, world.SourceJobID+composeInboxMessageSuffix, contracts.ComposeOceanCommandSubject, world.SourceJobID)
	if err != nil {
		return WorldBundle{}, err
	}
	if commandTag.RowsAffected() == 0 {
		if err := transaction.Commit(ctx); err != nil {
			return WorldBundle{}, err
		}
		return store.getWorldBySourceJob(ctx, world.SourceJobID)
	}
	visualIntentJSON, err := json.Marshal(world.VisualIntent)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal visual intent: %w", err)
	}
	dnaJSON, err := json.Marshal(world.OceanDNA)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal dna snapshot: %w", err)
	}
	configJSON, err := json.Marshal(variant.Config)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal scene config: %w", err)
	}
	if err := transaction.QueryRow(ctx, `INSERT INTO worlds
		(source_job_id, profile_id, dna_version_id, nickname, role, visual_intent, dna_snapshot, archetype, scene_name, quote)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id::text, created_at, updated_at`,
		world.SourceJobID, world.ProfileID, world.DNAVersionID, world.Nickname, world.Role, visualIntentJSON, dnaJSON, world.Archetype, world.SceneName, world.Quote,
	).Scan(&world.ID, &world.CreatedAt, &world.UpdatedAt); err != nil {
		return WorldBundle{}, mapConstraintViolation(err)
	}
	if err := transaction.QueryRow(ctx, `INSERT INTO world_variants (world_id, variant_no, seed, config, is_selected)
		VALUES ($1,$2,$3,$4,true) RETURNING id::text, created_at`, world.ID, variant.VariantNo, variant.Seed, configJSON).Scan(&variant.ID, &variant.CreatedAt); err != nil {
		return WorldBundle{}, mapConstraintViolation(err)
	}
	variant.WorldID = world.ID
	variant.IsSelected = true
	world.SelectedVariantID = &variant.ID
	world.Visibility = "private"
	world.Revision = 1
	if _, err := transaction.Exec(ctx, `UPDATE worlds SET selected_variant_id=$1 WHERE id=$2`, variant.ID, world.ID); err != nil {
		return WorldBundle{}, err
	}
	// The completed event carries the world's first snapshot rather than a
	// separate world.changed event being published alongside it: analytics
	// then has one projection function, with `completed` as revision 1 and
	// `world.changed` as every revision after it.
	createdSnapshot := newWorldSnapshot(world, 1, variant.VariantNo, variant.Seed, nil)
	completedEnvelope := contracts.NewEnvelope(world.SourceJobID, contracts.FamilyCompletedData{
		Family: contracts.WorldFamilyOcean, ProfileID: world.ProfileID, DNAVersionID: world.DNAVersionID,
		WorldID: world.ID, Snapshot: &createdSnapshot,
	})
	completedPayload, err := json.Marshal(completedEnvelope)
	if err != nil {
		return WorldBundle{}, err
	}
	if _, err := transaction.Exec(ctx, `INSERT INTO outbox_messages (message_id, subject, payload) VALUES ($1,$2,$3)`,
		world.SourceJobID+completedOutboxMessageSuffix, contracts.OceanCompletedEventSubject, completedPayload); err != nil {
		return WorldBundle{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: []models.WorldVariant{variant}}, nil
}

func (store *PostgresStore) GetWorld(ctx context.Context, worldID string) (WorldBundle, error) {
	return store.getWorldBundle(ctx, `w.id=$1`, worldID)
}

func (store *PostgresStore) getWorldBySourceJob(ctx context.Context, sourceJobID string) (WorldBundle, error) {
	return store.getWorldBundle(ctx, `w.source_job_id=$1`, sourceJobID)
}

func (store *PostgresStore) getWorldBundle(ctx context.Context, predicate, argument string) (WorldBundle, error) {
	batch := &pgx.Batch{}
	batch.Queue(`SELECT `+worldSelectColumns+` FROM worlds w LEFT JOIN world_shares s ON s.world_id=w.id WHERE `+predicate, argument)
	batch.Queue(`SELECT `+variantSelectColumns+` FROM world_variants WHERE world_id=(SELECT id FROM worlds WHERE `+stringsWithoutAlias(predicate)+`) ORDER BY variant_no`, argument)
	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()
	world, err := scanWorld(results.QueryRow())
	if err != nil {
		return WorldBundle{}, mapNotFound(err)
	}
	rows, err := results.Query()
	if err != nil {
		return WorldBundle{}, err
	}
	variants, err := scanVariantRows(rows)
	if err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: variants}, nil
}

func (store *PostgresStore) GetWorldsByIDs(ctx context.Context, worldIDs []string) ([]WorldBundle, error) {
	if len(worldIDs) == 0 {
		return nil, nil
	}
	rows, err := store.pool.Query(ctx, `SELECT `+worldSelectColumns+` FROM worlds w LEFT JOIN world_shares s ON s.world_id=w.id WHERE w.id = ANY($1::uuid[])`, worldIDs)
	if err != nil {
		return nil, err
	}
	worldsByID := make(map[string]models.World, len(worldIDs))
	for rows.Next() {
		world, scanError := scanWorld(rows)
		if scanError != nil {
			rows.Close()
			return nil, scanError
		}
		worldsByID[world.ID] = world
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	variantsByWorldID, err := store.getVariantsForWorlds(ctx, worldIDs)
	if err != nil {
		return nil, err
	}
	bundles := make([]WorldBundle, 0, len(worldsByID))
	for _, worldID := range worldIDs {
		world, found := worldsByID[worldID]
		if found {
			bundles = append(bundles, WorldBundle{World: world, Variants: variantsByWorldID[worldID]})
		}
	}
	return bundles, nil
}

// AddVariant runs in a transaction so the new variant and the world-change
// event it produces commit together — the same atomicity CreateWorld has
// always had. Before analytics-service this method wrote no event and needed
// no transaction.
func (store *PostgresStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	configJSON, err := json.Marshal(variant.Config)
	if err != nil {
		return models.WorldVariant{}, fmt.Errorf("marshal scene config: %w", err)
	}
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return models.WorldVariant{}, err
	}
	defer transaction.Rollback(ctx)
	row := transaction.QueryRow(ctx, `INSERT INTO world_variants (world_id, variant_no, seed, config)
		VALUES ($1,$2,$3,$4) RETURNING id::text, world_id::text, created_at`, worldID, variant.VariantNo, variant.Seed, configJSON)
	if err := row.Scan(&variant.ID, &variant.WorldID, &variant.CreatedAt); err != nil {
		return models.WorldVariant{}, mapConstraintViolation(err)
	}
	if err := recordWorldChange(ctx, transaction, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return models.WorldVariant{}, err
	}
	return variant, nil
}

func (store *PostgresStore) SelectVariant(ctx context.Context, worldID, variantID string) (models.WorldVariant, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return models.WorldVariant{}, err
	}
	defer transaction.Rollback(ctx)
	if _, err := transaction.Exec(ctx, `UPDATE world_variants SET is_selected=false WHERE world_id=$1`, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	variant, err := scanVariant(transaction.QueryRow(ctx, `UPDATE world_variants SET is_selected=true WHERE world_id=$1 AND id=$2 RETURNING `+variantSelectColumns, worldID, variantID))
	if err != nil {
		return models.WorldVariant{}, mapNotFound(err)
	}
	if _, err := transaction.Exec(ctx, `UPDATE worlds SET selected_variant_id=$1, updated_at=NOW() WHERE id=$2`, variantID, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	if err := recordWorldChange(ctx, transaction, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return models.WorldVariant{}, err
	}
	return variant, nil
}

// PublishWorld stays idempotent: a world that already has a share row is
// returned unchanged, with no revision bump and no event. Emitting a
// world-change snapshot for a re-publish would describe a state change that
// did not happen.
func (store *PostgresStore) PublishWorld(ctx context.Context, worldID, shareSlug string) (models.World, error) {
	var existingSlug string
	err := store.pool.QueryRow(ctx, `SELECT share_slug FROM world_shares WHERE world_id=$1`, worldID).Scan(&existingSlug)
	if err == nil {
		bundle, getError := store.GetWorld(ctx, worldID)
		return bundle.World, getError
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return models.World{}, err
	}
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return models.World{}, err
	}
	defer transaction.Rollback(ctx)
	if _, err := transaction.Exec(ctx, `INSERT INTO world_shares (world_id, share_slug) VALUES ($1,$2)`, worldID, shareSlug); err != nil {
		return models.World{}, mapConstraintViolation(err)
	}
	if err := recordWorldChange(ctx, transaction, worldID); err != nil {
		return models.World{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return models.World{}, err
	}
	bundle, err := store.GetWorld(ctx, worldID)
	return bundle.World, err
}

func (store *PostgresStore) GetPublicWorld(ctx context.Context, shareSlug string) (WorldBundle, error) {
	return store.getWorldBundle(ctx, `s.share_slug=$1`, shareSlug)
}

func (store *PostgresStore) PendingOutbox(ctx context.Context, maximumMessages int) ([]OutboxMessage, error) {
	rows, err := store.pool.Query(ctx, `SELECT id::text, message_id, subject, payload FROM outbox_messages WHERE published_at IS NULL ORDER BY created_at LIMIT $1`, maximumMessages)
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

const worldSelectColumns = `w.id::text, w.source_job_id, w.profile_id::text, w.dna_version_id::text,
	w.nickname, COALESCE(w.role,''), w.visual_intent, w.dna_snapshot, w.archetype, w.scene_name, w.quote,
	CASE WHEN s.id IS NULL THEN 'private' ELSE 'public' END, s.share_slug, w.selected_variant_id::text,
	w.created_at, w.updated_at, w.revision`

const variantSelectColumns = `id::text, world_id::text, variant_no, seed, config, COALESCE(thumbnail_url,''), is_selected, created_at`

type rowScanner interface {
	Scan(...any) error
}

func scanWorld(scanner rowScanner) (models.World, error) {
	var world models.World
	var visualIntentJSON, dnaJSON []byte
	if err := scanner.Scan(&world.ID, &world.SourceJobID, &world.ProfileID, &world.DNAVersionID, &world.Nickname, &world.Role,
		&visualIntentJSON, &dnaJSON, &world.Archetype, &world.SceneName, &world.Quote, &world.Visibility, &world.ShareSlug,
		&world.SelectedVariantID, &world.CreatedAt, &world.UpdatedAt, &world.Revision); err != nil {
		return models.World{}, err
	}
	if err := json.Unmarshal(visualIntentJSON, &world.VisualIntent); err != nil {
		return models.World{}, fmt.Errorf("decode visual intent for %s: %w", world.ID, err)
	}
	if err := json.Unmarshal(dnaJSON, &world.OceanDNA); err != nil {
		return models.World{}, fmt.Errorf("decode dna snapshot for %s: %w", world.ID, err)
	}
	world.ShortNarrative = world.OceanDNA.ShortNarrative
	return world, nil
}

func scanVariant(scanner rowScanner) (models.WorldVariant, error) {
	var variant models.WorldVariant
	var configJSON []byte
	if err := scanner.Scan(&variant.ID, &variant.WorldID, &variant.VariantNo, &variant.Seed, &configJSON, &variant.ThumbnailURL, &variant.IsSelected, &variant.CreatedAt); err != nil {
		return models.WorldVariant{}, err
	}
	if err := json.Unmarshal(configJSON, &variant.Config); err != nil {
		return models.WorldVariant{}, fmt.Errorf("decode scene config for variant %s: %w", variant.ID, err)
	}
	return variant, nil
}

func scanVariantRows(rows pgx.Rows) ([]models.WorldVariant, error) {
	defer rows.Close()
	var variants []models.WorldVariant
	for rows.Next() {
		variant, err := scanVariant(rows)
		if err != nil {
			return nil, err
		}
		variants = append(variants, variant)
	}
	return variants, rows.Err()
}

func (store *PostgresStore) getVariantsForWorlds(ctx context.Context, worldIDs []string) (map[string][]models.WorldVariant, error) {
	rows, err := store.pool.Query(ctx, `SELECT `+variantSelectColumns+` FROM world_variants WHERE world_id = ANY($1::uuid[]) ORDER BY world_id, variant_no`, worldIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	variantsByWorldID := make(map[string][]models.WorldVariant, len(worldIDs))
	for rows.Next() {
		variant, scanError := scanVariant(rows)
		if scanError != nil {
			return nil, scanError
		}
		variantsByWorldID[variant.WorldID] = append(variantsByWorldID[variant.WorldID], variant)
	}
	return variantsByWorldID, rows.Err()
}

func stringsWithoutAlias(predicate string) string {
	switch predicate {
	case `w.id=$1`:
		return `id=$1`
	case `w.source_job_id=$1`:
		return `source_job_id=$1`
	case `s.share_slug=$1`:
		return `id=(SELECT world_id FROM world_shares WHERE share_slug=$1)`
	default:
		return `id=$1`
	}
}

func mapNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func mapConstraintViolation(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case postgresUniqueViolationCode:
			return ErrConflict
		case postgresForeignKeyCode:
			return ErrNotFound
		}
	}
	return mapNotFound(err)
}
