package repositories

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

// The analytics read model drifts silently if a future mutation forgets to
// emit its snapshot: the world keeps changing in this database and stops
// changing in the admin app, with nothing failing anywhere. This test is the
// cheap guard the design's cost table asks for — every mutating store method
// must leave an event behind.
//
// If a new mutation is added to Store, add it here too. A method that
// legitimately changes nothing (a re-publish) belongs in
// TestUnchangedMutationsEmitNothing instead.
func TestEveryMutationEmitsAWorldChangeEvent(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	bundle := createSnapshotTestWorld(t, store)
	worldID := bundle.World.ID

	drainOutbox(t, store)

	mutations := []struct {
		name             string
		mutate           func() error
		expectedRevision int
	}{
		{
			name: "AddVariant",
			mutate: func() error {
				_, err := store.AddVariant(ctx, worldID, models.WorldVariant{ID: "variant-2", VariantNo: 2, Seed: "seed-2"})
				return err
			},
			expectedRevision: 2,
		},
		{
			name: "SelectVariant",
			mutate: func() error {
				_, err := store.SelectVariant(ctx, worldID, "variant-2")
				return err
			},
			expectedRevision: 3,
		},
		{
			name: "PublishWorld",
			mutate: func() error {
				_, err := store.PublishWorld(ctx, worldID, "share-slug-1")
				return err
			},
			expectedRevision: 4,
		},
	}

	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			if err := mutation.mutate(); err != nil {
				t.Fatalf("%s: %v", mutation.name, err)
			}
			messages := drainOutbox(t, store)
			if len(messages) != 1 {
				t.Fatalf("%s wrote %d outbox messages, want exactly 1", mutation.name, len(messages))
			}
			message := messages[0]
			if message.Subject != contracts.UniverseWorldChangedEventSubject {
				t.Fatalf("%s published on %q, want %q", mutation.name, message.Subject, contracts.UniverseWorldChangedEventSubject)
			}
			expectedMessageID := WorldChangedMessageID(worldID, mutation.expectedRevision)
			if message.MessageID != expectedMessageID {
				t.Fatalf("%s message id = %q, want %q", mutation.name, message.MessageID, expectedMessageID)
			}
			snapshot := decodeSnapshot(t, message.Payload)
			if snapshot.Revision != mutation.expectedRevision {
				t.Fatalf("%s snapshot revision = %d, want %d", mutation.name, snapshot.Revision, mutation.expectedRevision)
			}
			if snapshot.Family != contracts.WorldFamilyUniverse || snapshot.WorldID != worldID {
				t.Fatalf("%s snapshot identifies the wrong world: %#v", mutation.name, snapshot)
			}
		})
	}
}

// The snapshot's seed must be the SELECTED variant's, because that is the one
// the renderer draws — and therefore the one whose rare-feature lottery the
// admin app replays. Sending the world's first variant seed forever would make
// every observed rarity rate describe a scene nobody is looking at.
func TestSnapshotCarriesTheSelectedVariantSeed(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	bundle := createSnapshotTestWorld(t, store)
	worldID := bundle.World.ID

	created := drainOutbox(t, store)
	var createdEnvelope contracts.Envelope[contracts.FamilyCompletedData]
	if err := json.Unmarshal(created[0].Payload, &createdEnvelope); err != nil {
		t.Fatalf("decode completed event: %v", err)
	}
	if createdEnvelope.Data.Snapshot.VariantSeed != "seed-1" {
		t.Fatalf("created snapshot seed = %q, want %q", createdEnvelope.Data.Snapshot.VariantSeed, "seed-1")
	}

	if _, err := store.AddVariant(ctx, worldID, models.WorldVariant{ID: "variant-2", VariantNo: 2, Seed: "seed-2"}); err != nil {
		t.Fatal(err)
	}
	// Adding a variant does not change which one is selected, so the seed must
	// not move yet.
	if snapshot := decodeSnapshot(t, drainOutbox(t, store)[0].Payload); snapshot.VariantSeed != "seed-1" {
		t.Fatalf("adding a variant moved the seed to %q", snapshot.VariantSeed)
	}

	if _, err := store.SelectVariant(ctx, worldID, "variant-2"); err != nil {
		t.Fatal(err)
	}
	if snapshot := decodeSnapshot(t, drainOutbox(t, store)[0].Payload); snapshot.VariantSeed != "seed-2" {
		t.Fatalf("selecting variant 2 left the seed at %q, want %q", snapshot.VariantSeed, "seed-2")
	}
}

// A re-publish is the one mutation-shaped call that changes no state. It must
// stay silent, or the read model gains a revision describing nothing.
func TestUnchangedMutationsEmitNothing(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	bundle := createSnapshotTestWorld(t, store)
	if _, err := store.PublishWorld(ctx, bundle.World.ID, "share-slug-1"); err != nil {
		t.Fatal(err)
	}
	drainOutbox(t, store)
	if _, err := store.PublishWorld(ctx, bundle.World.ID, "share-slug-2"); err != nil {
		t.Fatal(err)
	}
	if messages := drainOutbox(t, store); len(messages) != 0 {
		t.Fatalf("re-publishing emitted %d events, want none", len(messages))
	}
}

// The created world's snapshot rides on the completed event rather than a
// separate world.changed event, which is what lets analytics-service have a
// single projection function.
func TestCreateWorldCarriesTheFirstSnapshotOnTheCompletedEvent(t *testing.T) {
	store := NewMemoryStore()
	bundle := createSnapshotTestWorld(t, store)
	messages := drainOutbox(t, store)
	if len(messages) != 1 {
		t.Fatalf("CreateWorld wrote %d outbox messages, want exactly 1", len(messages))
	}
	if messages[0].Subject != contracts.UniverseCompletedEventSubject {
		t.Fatalf("CreateWorld published on %q, want %q", messages[0].Subject, contracts.UniverseCompletedEventSubject)
	}
	var envelope contracts.Envelope[contracts.FamilyCompletedData]
	if err := json.Unmarshal(messages[0].Payload, &envelope); err != nil {
		t.Fatalf("decode completed event: %v", err)
	}
	snapshot := envelope.Data.Snapshot
	if snapshot == nil {
		t.Fatal("completed event carries no snapshot; analytics cannot project a newly created world")
	}
	if snapshot.Revision != 1 {
		t.Fatalf("first snapshot revision = %d, want 1", snapshot.Revision)
	}
	if snapshot.WorldID != bundle.World.ID || snapshot.Nickname != "Nova" || snapshot.Archetype != "Curious Builder" {
		t.Fatalf("first snapshot lost identifying fields: %#v", snapshot)
	}
	if snapshot.VariantCount != 1 || snapshot.SelectedVariantNo != 1 {
		t.Fatalf("first snapshot variant counters = %d/%d, want 1/1", snapshot.VariantCount, snapshot.SelectedVariantNo)
	}
	if snapshot.PublishedAt != nil {
		t.Fatalf("a newly created world is not published: %v", snapshot.PublishedAt)
	}
}

// The snapshot is an allow list. Anything the boundary forbids must be
// absent from the serialized event, not merely unread by the consumer.
func TestSnapshotCarriesNoForbiddenField(t *testing.T) {
	store := NewMemoryStore()
	createSnapshotTestWorld(t, store)
	messages := drainOutbox(t, store)
	encoded := strings.ToLower(string(messages[0].Payload))
	forbiddenFragments := []string{"quote", "dnasnapshot", "rawinput", "profiledna", "shareslug", "config", "shortnarrative"}
	for _, fragment := range forbiddenFragments {
		if strings.Contains(encoded, fragment) {
			t.Fatalf("snapshot payload leaked %q: %s", fragment, encoded)
		}
	}
}

func createSnapshotTestWorld(t *testing.T, store *MemoryStore) WorldBundle {
	t.Helper()
	world := models.World{
		SourceJobID:  "job-1",
		ProfileID:    "profile-1",
		DNAVersionID: "dna-1",
		Nickname:     "Nova",
		Role:         "Builder",
		Archetype:    "Curious Builder",
		SceneName:    "Nova's Living Horizon",
		Quote:        "Curiosity creates new orbits.",
		Visibility:   "private",
		VisualIntent: models.VisualIntent{
			Mood:                "curious",
			FavoriteColors:      []string{"#8B5CF6"},
			PreferredWorldStyle: "nebula",
		},
		PersonalityDNA: models.PersonalityDNA{
			TraitScores: models.TraitScores{Creativity: 82, Discipline: 76, Curiosity: 91, Energy: 70, Focus: 84},
		},
	}
	bundle, err := store.CreateWorld(context.Background(), world, models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatalf("create world: %v", err)
	}
	return bundle
}

func drainOutbox(t *testing.T, store *MemoryStore) []OutboxMessage {
	t.Helper()
	messages, err := store.PendingOutbox(context.Background(), 100)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	for _, message := range messages {
		if err := store.MarkOutboxPublished(context.Background(), message.ID); err != nil {
			t.Fatalf("mark outbox published: %v", err)
		}
	}
	return messages
}

func decodeSnapshot(t *testing.T, payload []byte) contracts.WorldSnapshot {
	t.Helper()
	var envelope contracts.Envelope[contracts.FamilyWorldChangedData]
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode world changed event: %v", err)
	}
	return envelope.Data.Snapshot
}
