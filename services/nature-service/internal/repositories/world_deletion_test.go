package repositories

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/shared/family-platform/go/ownership"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

const deletionTestOwnerAccountID = "11111111-1111-1111-1111-111111111111"
const deletionTestStrangerAccountID = "33333333-3333-3333-3333-333333333333"

// The flag is a flag, and the row stays. Deletion is reversible for ever
// (decision 4), which is a property of the SQL rather than of any Go code: an
// `UPDATE` that sets a timestamp, and nowhere in this package a statement that
// removes the row.
func TestDeletionIsAFlagAndNeverRemovesTheRow(t *testing.T) {
	schema := readAllMigrations(t)

	if !regexp.MustCompile(`ALTER TABLE worlds ADD COLUMN deleted_at TIMESTAMPTZ;`).MatchString(schema) {
		t.Error("deleted_at is not a bare nullable timestamp. NOT NULL or a DEFAULT would rewrite every world in production on deploy, and a boolean would throw away the only fact that makes a deletion answerable rather than merely reversible")
	}

	destructivePattern := regexp.MustCompile(`(?is)DELETE\s+FROM\s+worlds\b|DROP\s+TABLE\s+IF\s+EXISTS\s+worlds\b`)
	for _, path := range packageSourceFiles(t) {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if destructivePattern.MatchString(string(contents)) {
			t.Errorf("%s removes world rows. Deletion is a flag and is reversible for ever; a purge would make the admin restore path impossible and would silently change what analytics already counted", path)
		}
	}
}

// Deleting is owner-only, and it is stricter than every other mutation. The
// table states both halves, because the second is the surprising one: an
// unowned world is mutable by anyone holding its id and deletable by NOBODY.
//
// That is deliberate. A stranger adding a variant to a world they were sent a
// link to is annoying and reversible; a stranger deleting it takes the world
// out of its maker's gallery, and the maker cannot put it back. Nobody can
// prove they made an unowned world, so nobody may delete one — until the claim
// (S8-IDENTITY-011) gives it an owner.
func TestDeletingIsOwnerOnly(t *testing.T) {
	owner := deletionTestOwnerAccountID
	stranger := deletionTestStrangerAccountID

	callers := []struct {
		description         string
		worldOwnerAccountID *string
		requestingAccountID *string
		expectedError       error
	}{
		{description: "the owner", worldOwnerAccountID: &owner, requestingAccountID: &owner, expectedError: nil},
		{description: "a stranger", worldOwnerAccountID: &owner, requestingAccountID: &stranger, expectedError: ownership.ErrNotWorldOwner},
		{description: "nobody signed in", worldOwnerAccountID: &owner, requestingAccountID: nil, expectedError: ownership.ErrNotWorldOwner},
		{description: "anyone at all, on an unowned world", worldOwnerAccountID: nil, requestingAccountID: &stranger, expectedError: ownership.ErrWorldNotOwned},
		{description: "nobody signed in, on an unowned world", worldOwnerAccountID: nil, requestingAccountID: nil, expectedError: ownership.ErrWorldNotOwned},
	}

	for _, caller := range callers {
		t.Run(caller.description, func(t *testing.T) {
			store := NewMemoryStore()
			bundle, err := store.CreateWorld(context.Background(),
				models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: caller.worldOwnerAccountID},
				models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
			if err != nil {
				t.Fatal(err)
			}
			_, deletionError := store.DeleteWorld(context.Background(), bundle.World.ID, caller.requestingAccountID)
			if !errors.Is(deletionError, caller.expectedError) {
				t.Fatalf("delete by %s: error = %v, want %v", caller.description, deletionError, caller.expectedError)
			}
		})
	}
}

// Every product read, in one test, because "it stops being visible" is a claim
// about all of them at once. A caller holding the raw UUID and no browser has
// to be refused too — a frontend hiding a card it was handed is not a
// deletion, because the data is still on the wire.
func TestADeletedWorldIsGoneFromEveryReadButStillInTheStore(t *testing.T) {
	owner := deletionTestOwnerAccountID
	store := NewMemoryStore()
	ctx := context.Background()

	bundle, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: &owner},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	worldID := bundle.World.ID
	if _, err := store.PublishWorld(ctx, worldID, "share-slug-1", &owner); err != nil {
		t.Fatal(err)
	}

	deletion, err := store.DeleteWorld(ctx, worldID, &owner)
	if err != nil {
		t.Fatal(err)
	}
	if deletion.ShareSlug != "share-slug-1" {
		t.Fatalf("share slug = %q, want share-slug-1. Without it the gateway cannot drop the cached share response, and a deleted world keeps resolving at its public URL for a whole cache TTL", deletion.ShareSlug)
	}

	if _, err := store.GetWorld(ctx, worldID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetWorld after deletion: error = %v, want ErrNotFound", err)
	}
	batch, err := store.GetWorldsByIDs(ctx, []string{worldID})
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 0 {
		t.Errorf("a deleted world is still in a ?ids= batch: %+v", batch)
	}
	if _, err := store.GetPublicWorld(ctx, "share-slug-1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetPublicWorld after deletion: error = %v, want ErrNotFound", err)
	}

	// The other half of "reversible for ever": the world is unreadable, and it
	// is still there.
	if _, present := store.worlds[worldID]; !present {
		t.Error("the world row is gone. Deletion is a flag: an admin restore has to be possible, and analytics counted this world already")
	}
}

// A second deletion is not an error and does not move the timestamp. The second
// click of a button and a retried request must answer the way the first did.
func TestDeletingTwiceChangesNothingTheSecondTime(t *testing.T) {
	owner := deletionTestOwnerAccountID
	store := NewMemoryStore()
	ctx := context.Background()

	bundle, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: &owner},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteWorld(ctx, bundle.World.ID, &owner); err != nil {
		t.Fatal(err)
	}
	firstDeletedAt := store.deletedAt[bundle.World.ID]
	if _, err := store.DeleteWorld(ctx, bundle.World.ID, &owner); err != nil {
		t.Fatalf("deleting an already-deleted world: %v", err)
	}
	if !store.deletedAt[bundle.World.ID].Equal(firstDeletedAt) {
		t.Error("the second deletion moved the timestamp; COALESCE in the Postgres store keeps the first, and this mirror has to agree")
	}
}

// Analytics is deliberately untouched (decision 4b), so a deletion emits
// nothing: the snapshot it would produce is byte-identical to the last one,
// because there is no deleted field in the projection to carry the difference.
// An event describing no visible change would make `world.changed` stop meaning
// "something you can see changed".
func TestDeletingEmitsNoEvent(t *testing.T) {
	owner := deletionTestOwnerAccountID
	store := NewMemoryStore()
	ctx := context.Background()

	bundle, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: &owner},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	beforeDeletion, err := store.PendingOutbox(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteWorld(ctx, bundle.World.ID, &owner); err != nil {
		t.Fatal(err)
	}
	afterDeletion, err := store.PendingOutbox(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(afterDeletion) != len(beforeDeletion) {
		t.Fatalf("deletion staged %d outbox message(s). Staff statistics keep counting a deleted world on purpose; an event here would either be ignored or would start shrinking historical totals", len(afterDeletion)-len(beforeDeletion))
	}
}

// The read that must NOT filter, named so that somebody tidying the store into
// consistency has to read why first.
func TestTheCreatePathStillFindsADeletedWorld(t *testing.T) {
	postgresStoreSource, err := os.ReadFile("postgres_store.go")
	if err != nil {
		t.Fatalf("read postgres_store.go: %v", err)
	}
	source := string(postgresStoreSource)
	if !strings.Contains(source, "func (store *PostgresStore) getWorldBySourceJob") {
		t.Fatal("getWorldBySourceJob is gone; the create path's idempotency lookup has moved and this assertion no longer describes anything")
	}
	sourceJobLookup := source[strings.Index(source, "func (store *PostgresStore) getWorldBySourceJob"):]
	sourceJobLookup = sourceJobLookup[:strings.Index(sourceJobLookup, "\n}")]
	if !strings.Contains(sourceJobLookup, "deletedWorldsIncluded") {
		t.Error("the create path's idempotency lookup now filters deleted worlds. A world deleted between its create and a JetStream redelivery would look like one that was never created, and the redelivery would repeat for ever against a row that is not missing")
	}
}

// Found in review, and it is the half a deletion is easy to forget: every
// product READ stops returning the world, so every MUTATION has to stop
// accepting it too. Without this, a caller holding the UUID could keep adding
// variants to and publishing a world nobody can see - writing rows and emitting
// world-change events for something that renders nowhere.
//
// Deleting again is the deliberate exception, and it is asserted alongside so
// the two rules stay visible together.
func TestADeletedWorldAcceptsNoMutationButAcceptsAnotherDeletion(t *testing.T) {
	owner := deletionTestOwnerAccountID
	store := NewMemoryStore()
	ctx := context.Background()

	bundle, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: &owner},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	worldID := bundle.World.ID
	if _, err := store.DeleteWorld(ctx, worldID, &owner); err != nil {
		t.Fatal(err)
	}

	// The owner's own mutations, which is the strongest form of the case: it is
	// not authorisation that refuses them.
	for _, mutation := range worldMutations {
		t.Run(mutation.methodName, func(t *testing.T) {
			mutationError := mutation.mutate(store, worldID, "variant-1", &owner)
			if !errors.Is(mutationError, ErrNotFound) {
				t.Fatalf("%s on a deleted world: error = %v, want ErrNotFound", mutation.methodName, mutationError)
			}
		})
	}

	if _, err := store.DeleteWorld(ctx, worldID, &owner); err != nil {
		t.Fatalf("deleting an already-deleted world must stay idempotent: %v", err)
	}
}
