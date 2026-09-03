package repositories

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

type MemoryStore struct {
	mu       sync.RWMutex
	worlds   map[string]models.World
	variants map[string][]models.WorldVariant
	slugs    map[string]string
	jobs     map[string]string
	// publishedAt stands in for the world_shares.created_at column the
	// Postgres store reads, so a snapshot built here carries the same
	// publish timestamp the real one would.
	publishedAt map[string]time.Time
	outbox      []OutboxMessage
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		worlds:      map[string]models.World{},
		variants:    map[string][]models.WorldVariant{},
		slugs:       map[string]string{},
		jobs:        map[string]string{},
		publishedAt: map[string]time.Time{},
	}
}

func (s *MemoryStore) CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant) (WorldBundle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existingWorldID, found := s.jobs[world.SourceJobID]; found {
		return WorldBundle{World: s.worlds[existingWorldID], Variants: cloneVariants(s.variants[existingWorldID])}, nil
	}
	now := time.Now().UTC()
	if world.ID == "" {
		world.ID = uuid.NewString()
	}
	if variant.ID == "" {
		variant.ID = uuid.NewString()
	}
	world.CreatedAt = now
	world.UpdatedAt = now
	world.Revision = 1
	variant.WorldID = world.ID
	variant.CreatedAt = now
	variant.IsSelected = true
	world.SelectedVariantID = &variant.ID
	s.worlds[world.ID] = world
	s.variants[world.ID] = []models.WorldVariant{variant}
	s.jobs[world.SourceJobID] = world.ID
	createdSnapshot := newWorldSnapshot(world, 1, variant.VariantNo, variant.Seed, nil)
	completedEnvelope := contracts.NewEnvelope(world.SourceJobID, contracts.FamilyCompletedData{
		Family: contracts.WorldFamilyUniverse, ProfileID: world.ProfileID, DNAVersionID: world.DNAVersionID,
		WorldID: world.ID, Snapshot: &createdSnapshot,
	})
	payload, err := json.Marshal(completedEnvelope)
	if err != nil {
		return WorldBundle{}, err
	}
	s.outbox = append(s.outbox, OutboxMessage{ID: uuid.NewString(), MessageID: world.SourceJobID + ":universe-completed", Subject: contracts.UniverseCompletedEventSubject, Payload: payload})
	return WorldBundle{World: world, Variants: []models.WorldVariant{variant}}, nil
}

func (s *MemoryStore) GetWorld(ctx context.Context, worldID string) (WorldBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return WorldBundle{}, ErrNotFound
	}
	return WorldBundle{World: world, Variants: cloneVariants(s.variants[worldID])}, nil
}

func (s *MemoryStore) GetWorldsByIDs(ctx context.Context, worldIDs []string) ([]WorldBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	bundles := make([]WorldBundle, 0, len(worldIDs))
	for _, worldID := range worldIDs {
		world, ok := s.worlds[worldID]
		if !ok {
			continue
		}
		bundles = append(bundles, WorldBundle{World: world, Variants: cloneVariants(s.variants[worldID])})
	}
	return bundles, nil
}

func (s *MemoryStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant, requestingAccountID *string) (models.WorldVariant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return models.WorldVariant{}, ErrNotFound
	}
	if err := worldMutationPermitted(world.OwnerAccountID, requestingAccountID); err != nil {
		return models.WorldVariant{}, err
	}
	for _, existingVariant := range s.variants[worldID] {
		if existingVariant.VariantNo == variant.VariantNo || existingVariant.Seed == variant.Seed {
			return models.WorldVariant{}, ErrConflict
		}
	}
	if variant.ID == "" {
		variant.ID = uuid.NewString()
	}
	variant.WorldID = worldID
	variant.CreatedAt = time.Now().UTC()
	s.variants[worldID] = append(s.variants[worldID], variant)
	if err := s.recordWorldChange(worldID); err != nil {
		return models.WorldVariant{}, err
	}
	return variant, nil
}

func (s *MemoryStore) SelectVariant(ctx context.Context, worldID, variantID string, requestingAccountID *string) (models.WorldVariant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return models.WorldVariant{}, ErrNotFound
	}
	if err := worldMutationPermitted(world.OwnerAccountID, requestingAccountID); err != nil {
		return models.WorldVariant{}, err
	}
	selectedVariantIndex := -1
	for i := range s.variants[worldID] {
		if s.variants[worldID][i].ID == variantID {
			selectedVariantIndex = i
			break
		}
	}
	if selectedVariantIndex < 0 {
		return models.WorldVariant{}, ErrNotFound
	}
	for i := range s.variants[worldID] {
		s.variants[worldID][i].IsSelected = i == selectedVariantIndex
	}
	selected := s.variants[worldID][selectedVariantIndex]
	world.SelectedVariantID = &variantID
	world.UpdatedAt = time.Now().UTC()
	s.worlds[worldID] = world
	if err := s.recordWorldChange(worldID); err != nil {
		return models.WorldVariant{}, err
	}
	return selected, nil
}

func (s *MemoryStore) PublishWorld(ctx context.Context, worldID, slug string, requestingAccountID *string) (models.World, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return models.World{}, ErrNotFound
	}
	if err := worldMutationPermitted(world.OwnerAccountID, requestingAccountID); err != nil {
		return models.World{}, err
	}
	alreadyPublished := world.ShareSlug != nil
	if !alreadyPublished {
		if existingWorldID, slugTaken := s.slugs[slug]; slugTaken && existingWorldID != worldID {
			return models.World{}, ErrConflict
		}
		world.ShareSlug = &slug
	}
	world.Visibility = "public"
	world.UpdatedAt = time.Now().UTC()
	s.worlds[worldID] = world
	s.slugs[*world.ShareSlug] = worldID
	// Mirrors PostgresStore.PublishWorld: a re-publish changes nothing, so
	// it bumps no revision and emits no event.
	if alreadyPublished {
		return world, nil
	}
	s.publishedAt[worldID] = world.UpdatedAt
	if err := s.recordWorldChange(worldID); err != nil {
		return models.World{}, err
	}
	return s.worlds[worldID], nil
}

// recordWorldChange mirrors the Postgres path's bump-load-emit sequence so a
// test written against either store proves the same behaviour. Callers hold
// the write lock.
func (s *MemoryStore) recordWorldChange(worldID string) error {
	world, ok := s.worlds[worldID]
	if !ok {
		return ErrNotFound
	}
	world.Revision++
	world.UpdatedAt = time.Now().UTC()
	s.worlds[worldID] = world
	selectedVariantNo := 0
	selectedVariantSeed := ""
	for _, variant := range s.variants[worldID] {
		if world.SelectedVariantID != nil && variant.ID == *world.SelectedVariantID {
			selectedVariantNo = variant.VariantNo
			selectedVariantSeed = variant.Seed
		}
	}
	var publishedAt *time.Time
	if published, found := s.publishedAt[worldID]; found {
		publishedAt = &published
	}
	snapshot := newWorldSnapshot(world, len(s.variants[worldID]), selectedVariantNo, selectedVariantSeed, publishedAt)
	subject, err := snapshot.Family.WorldChangedEventSubject()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(contracts.NewEnvelope(snapshot.SourceJobID, contracts.FamilyWorldChangedData{Snapshot: snapshot}))
	if err != nil {
		return err
	}
	s.outbox = append(s.outbox, OutboxMessage{
		ID:        uuid.NewString(),
		MessageID: WorldChangedMessageID(snapshot.WorldID, snapshot.Revision),
		Subject:   subject,
		Payload:   payload,
	})
	return nil
}

func (s *MemoryStore) GetPublicWorld(ctx context.Context, slug string) (WorldBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	worldID, ok := s.slugs[slug]
	if !ok {
		return WorldBundle{}, ErrNotFound
	}
	world := s.worlds[worldID]
	if world.Visibility != "public" {
		return WorldBundle{}, ErrNotFound
	}
	return WorldBundle{World: world, Variants: cloneVariants(s.variants[worldID])}, nil
}

func (s *MemoryStore) Ping(ctx context.Context) error {
	return nil
}

func (s *MemoryStore) PendingOutbox(ctx context.Context, maximumMessages int) ([]OutboxMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if maximumMessages > len(s.outbox) {
		maximumMessages = len(s.outbox)
	}
	messages := make([]OutboxMessage, maximumMessages)
	copy(messages, s.outbox[:maximumMessages])
	return messages, nil
}

func (s *MemoryStore) MarkOutboxPublished(ctx context.Context, outboxID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for messageIndex, message := range s.outbox {
		if message.ID == outboxID {
			s.outbox = append(s.outbox[:messageIndex], s.outbox[messageIndex+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func cloneVariants(in []models.WorldVariant) []models.WorldVariant {
	out := make([]models.WorldVariant, len(in))
	copy(out, in)
	return out
}
