package repositories

import (
	"context"
	"encoding/json"
	"errors"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

var ErrNotFound = errors.New("not found")

// ErrConflict signals a uniqueness collision (duplicate variant number or
// share slug). Callers retry with fresh values instead of surfacing a 500.
var ErrConflict = errors.New("conflict")

type WorldBundle struct {
	World    models.World
	Variants []models.WorldVariant
}

type OutboxMessage struct {
	ID        string
	MessageID string
	Subject   string
	Payload   json.RawMessage
}

// Store is the same persistence contract as universe-service's; the postgres
// implementation arrives with the dedicated Neon database in the persistence
// round. Until then only MemoryStore exists.
type Store interface {
	CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant) (WorldBundle, error)
	GetWorld(ctx context.Context, worldID string) (WorldBundle, error)
	// GetWorldsByIDs returns the bundles for every id that exists, in the same
	// order as the requested ids; unknown ids are skipped rather than failing
	// the whole batch. Backs the gallery's single-request load.
	GetWorldsByIDs(ctx context.Context, worldIDs []string) ([]WorldBundle, error)
	// The three mutations, and the one parameter they all gained: who is
	// asking. nil means "no session", never "the owner" - see
	// ownership.MutationPermitted, which is where the rule lives.
	AddVariant(ctx context.Context, worldID string, variant models.WorldVariant, requestingAccountID *string) (models.WorldVariant, error)
	SelectVariant(ctx context.Context, worldID, variantID string, requestingAccountID *string) (models.WorldVariant, error)
	PublishWorld(ctx context.Context, worldID, slug string, requestingAccountID *string) (models.World, error)
	// DeleteWorld sets the flag and returns the share slug the world had, so
	// the gateway can drop a cache entry keyed by a slug only this service can
	// map a world id to. Owner-only, unlike the three above.
	DeleteWorld(ctx context.Context, worldID string, requestingAccountID *string) (models.WorldDeletion, error)
	// ClaimWorlds turns every world one anonymous visitor made into one
	// account's, and returns how many it moved. Not a mutation in the sense
	// the four above are: there is no requestingAccountID to check, because
	// the caller is dna-service acting on a command the gateway stamped from
	// a verified token - see world_ownership.go for why that is trustworthy.
	ClaimWorlds(ctx context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) (int64, error)
	GetPublicWorld(ctx context.Context, slug string) (WorldBundle, error)
	PendingOutbox(ctx context.Context, maximumMessages int) ([]OutboxMessage, error)
	MarkOutboxPublished(ctx context.Context, outboxID string) error
	// Ping reports whether the backing storage is reachable; used by /readyz.
	Ping(ctx context.Context) error
}
