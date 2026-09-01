package repositories

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// snapshotFamily is the one line that differs between this file and
// universe-service's copy of it.
const snapshotFamily = contracts.WorldFamilyNature

// WorldChangedMessageID is the outbox message id for a world-change event.
// It is exported so the drift-guard test can assert on the exact value
// rather than re-deriving the format and passing by construction.
func WorldChangedMessageID(worldID string, revision int) string {
	return fmt.Sprintf("%s:rev:%d", worldID, revision)
}

// worldSnapshotQuerier is satisfied by pgx.Tx and by *pgxpool.Pool alike, so
// a snapshot is always read through whichever handle performed the mutation.
// Reading it through the pool instead of the open transaction would return
// the pre-mutation state and publish a stale snapshot.
type worldSnapshotQuerier interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// newWorldSnapshot is the single place that decides what leaves this
// service's database for the analytics read model. It is an allow list, not
// a projection of the row: quote, dna_snapshot, visual variant config and
// share slugs are absent on purpose and must stay absent — see
// agent-system/plans/services/analytics-service-plan.md#data-boundary.
func newWorldSnapshot(world models.World, variantCount, selectedVariantNo int, selectedVariantSeed string, publishedAt *time.Time) contracts.WorldSnapshot {
	favoriteColors := world.VisualIntent.FavoriteColors
	if favoriteColors == nil {
		favoriteColors = []string{}
	}
	return contracts.WorldSnapshot{
		WorldID:        world.ID,
		Family:         snapshotFamily,
		ProfileID:      world.ProfileID,
		DNAVersionID:   world.DNAVersionID,
		SourceJobID:    world.SourceJobID,
		Revision:       world.Revision,
		Nickname:       world.Nickname,
		Role:           world.Role,
		Archetype:      world.Archetype,
		SceneName:      world.SceneName,
		Mood:           world.VisualIntent.Mood,
		WorldStyle:     world.VisualIntent.PreferredWorldStyle,
		FavoriteColors: favoriteColors,
		TraitScores: contracts.TraitScores{
			Creativity: world.NatureDNA.TraitScores.Creativity,
			Discipline: world.NatureDNA.TraitScores.Discipline,
			Curiosity:  world.NatureDNA.TraitScores.Curiosity,
			Energy:     world.NatureDNA.TraitScores.Energy,
			Focus:      world.NatureDNA.TraitScores.Focus,
		},
		VariantCount:      variantCount,
		SelectedVariantNo: selectedVariantNo,
		// The SELECTED variant's seed, not the world's first: it is what the
		// renderer draws from, so it is what the rare-wildlife lottery has to be
		// replayed against.
		VariantSeed:    selectedVariantSeed,
		PublishedAt:    publishedAt,
		WorldCreatedAt: world.CreatedAt,
	}
}

// bumpWorldRevision is called inside the mutation's own transaction. A
// mutation that changes nothing (a re-publish of an already-published world)
// must not call it, or the read model gains a snapshot describing no change.
func bumpWorldRevision(ctx context.Context, querier worldSnapshotQuerier, worldID string) error {
	commandTag, err := querier.Exec(ctx, `UPDATE worlds SET revision = revision + 1, updated_at = NOW() WHERE id = $1`, worldID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// loadWorldSnapshot reads the post-mutation aggregate in one round trip:
// the world row, how many variants it has, which variant number is selected,
// and when (if ever) it was published.
func loadWorldSnapshot(ctx context.Context, querier worldSnapshotQuerier, worldID string) (contracts.WorldSnapshot, error) {
	var world models.World
	var visualIntentJSON, dnaJSON []byte
	var variantCount, selectedVariantNo int
	var selectedVariantSeed string
	var publishedAt *time.Time
	// selected.seed rides along on the join that already resolves the selected
	// variant. It is COALESCEd because the join is a LEFT one: a world whose
	// selected_variant_id is somehow unset yields no row on that side, and a
	// NULL here would fail the scan rather than produce a world with no seed.
	err := querier.QueryRow(ctx, `SELECT w.id::text, w.source_job_id, w.profile_id::text, w.dna_version_id::text,
			w.revision, w.nickname, COALESCE(w.role,''), w.archetype, w.scene_name, w.visual_intent, w.dna_snapshot,
			COALESCE(counted.variant_count, 0), COALESCE(selected.variant_no, 0), COALESCE(selected.seed, ''), shared.created_at, w.created_at
		FROM worlds w
		LEFT JOIN (SELECT world_id, COUNT(*) AS variant_count FROM world_variants GROUP BY world_id) counted ON counted.world_id = w.id
		LEFT JOIN world_variants selected ON selected.id = w.selected_variant_id
		LEFT JOIN world_shares shared ON shared.world_id = w.id
		WHERE w.id = $1`, worldID).Scan(
		&world.ID, &world.SourceJobID, &world.ProfileID, &world.DNAVersionID,
		&world.Revision, &world.Nickname, &world.Role, &world.Archetype, &world.SceneName, &visualIntentJSON, &dnaJSON,
		&variantCount, &selectedVariantNo, &selectedVariantSeed, &publishedAt, &world.CreatedAt,
	)
	if err != nil {
		return contracts.WorldSnapshot{}, mapNotFound(err)
	}
	if err := json.Unmarshal(visualIntentJSON, &world.VisualIntent); err != nil {
		return contracts.WorldSnapshot{}, fmt.Errorf("decode visual intent for %s: %w", worldID, err)
	}
	if err := json.Unmarshal(dnaJSON, &world.NatureDNA); err != nil {
		return contracts.WorldSnapshot{}, fmt.Errorf("decode dna snapshot for %s: %w", worldID, err)
	}
	return newWorldSnapshot(world, variantCount, selectedVariantNo, selectedVariantSeed, publishedAt), nil
}

// writeWorldChangedOutbox stages the event in the same transaction as the
// mutation, which is what makes "the read model saw it" and "the write
// happened" impossible to disagree about.
func writeWorldChangedOutbox(ctx context.Context, querier worldSnapshotQuerier, snapshot contracts.WorldSnapshot) error {
	subject, err := snapshot.Family.WorldChangedEventSubject()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(contracts.NewEnvelope(snapshot.SourceJobID, contracts.FamilyWorldChangedData{Snapshot: snapshot}))
	if err != nil {
		return fmt.Errorf("marshal world changed event: %w", err)
	}
	_, err = querier.Exec(ctx, `INSERT INTO outbox_messages (message_id, subject, payload) VALUES ($1,$2,$3)`,
		WorldChangedMessageID(snapshot.WorldID, snapshot.Revision), subject, payload)
	return err
}

// recordWorldChange is the sequence every mutating store method runs after
// its own writes and before COMMIT. Keeping the three steps together is the
// guard against the drift this design's cost table names: a future mutation
// that forgets one of them silently stops feeding the read model.
func recordWorldChange(ctx context.Context, querier worldSnapshotQuerier, worldID string) error {
	if err := bumpWorldRevision(ctx, querier, worldID); err != nil {
		return err
	}
	snapshot, err := loadWorldSnapshot(ctx, querier, worldID)
	if err != nil {
		return err
	}
	return writeWorldChangedOutbox(ctx, querier, snapshot)
}
