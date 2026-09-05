package services

import (
	"context"
	"errors"
	"testing"

	"github.com/myunivokai/myunivokai/shared/family-platform/go/ownership"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
)

const readAuthorizationOwnerAccountID = "11111111-1111-1111-1111-111111111111"
const readAuthorizationStrangerAccountID = "33333333-3333-3333-3333-333333333333"

// newReadAuthorizationFixture exists because this service's own
// newTestWorldService takes a store, while nature's and ocean's build one and
// hand it back. Everything below this line is identical across the three
// families, so the difference is isolated here rather than spread through the
// tests.
func newReadAuthorizationFixture(t *testing.T) (*WorldService, *repositories.MemoryStore) {
	t.Helper()
	store := repositories.NewMemoryStore()
	return newTestWorldService(store), store
}

// createWorldOwnedBy puts one world in the store and returns its id, so each
// case below states only the thing it is about: who owns the world, and who is
// asking to read it.
func createWorldOwnedBy(t *testing.T, store *repositories.MemoryStore, name string, ownerAccountID *string) string {
	t.Helper()
	bundle, err := store.CreateWorld(context.Background(),
		models.World{SourceJobID: "job-" + name, Visibility: "private", OwnerAccountID: ownerAccountID},
		models.WorldVariant{ID: "variant-" + name, VariantNo: 1, Seed: "seed-" + name})
	if err != nil {
		t.Fatal(err)
	}
	return bundle.World.ID
}

// The defect this exists for, stated plainly because it shipped and was found
// from outside the repository: `GET /api/{family}/worlds/{id}` answered 200 to a
// caller with no credentials at all, for a world that had an owner and had
// never been published. What it handed over - the nickname, the role, every
// variant and the whole DNA snapshot - is strictly MORE than the share page is
// deliberately redacted down to.
//
// Nothing here could have caught it. The ownership ratchet in
// repositories/world_ownership_test.go classifies every Store method, and its
// question was "does this method mutate a world?"; GetWorld answered no and was
// filed under the reads. A read that hands a stranger somebody's private world
// is not a mutation, so the CATEGORY was the blind spot rather than the
// coverage.
//
// So the reads get the mutations' own table, with the same five callers, and
// the two worth reading twice are the same two. An UNOWNED world stays readable
// by a signed-in stranger, because that describes every world made before
// ownership existed and refusing them would have broken the product on the day
// this shipped. And an OWNED world is not readable by a caller with no session
// at all - nil means "no session", never "the owner".
func TestEveryWorldReadHonoursOwnership(t *testing.T) {
	owner := readAuthorizationOwnerAccountID
	stranger := readAuthorizationStrangerAccountID

	callers := []struct {
		description         string
		worldOwnerAccountID *string
		requestingAccountID *string
		expectedError       error
	}{
		{description: "an unowned world, and nobody signed in", worldOwnerAccountID: nil, requestingAccountID: nil, expectedError: nil},
		{description: "an unowned world, and a signed-in stranger", worldOwnerAccountID: nil, requestingAccountID: &stranger, expectedError: nil},
		{description: "an owned world, and its owner", worldOwnerAccountID: &owner, requestingAccountID: &owner, expectedError: nil},
		{description: "an owned world, and a stranger", worldOwnerAccountID: &owner, requestingAccountID: &stranger, expectedError: ownership.ErrNotWorldOwner},
		{description: "an owned world, and nobody signed in", worldOwnerAccountID: &owner, requestingAccountID: nil, expectedError: ownership.ErrNotWorldOwner},
	}

	for _, caller := range callers {
		t.Run(caller.description, func(t *testing.T) {
			service, store := newReadAuthorizationFixture(t)
			worldID := createWorldOwnedBy(t, store, "read", caller.worldOwnerAccountID)

			_, readError := service.GetWorld(context.Background(), worldID, caller.requestingAccountID)
			if !errors.Is(readError, caller.expectedError) {
				t.Fatalf("GetWorld: error = %v, want %v", readError, caller.expectedError)
			}
		})
	}
}

// The batch read FILTERS where the single read refuses, and the difference is
// worth its own test because choosing wrong is invisible until somebody has a
// stale id.
//
// The gallery hydrates its cards from ids the browser keeps in localStorage. On
// a shared device, or after signing into a second account, one of those can
// belong to somebody else - and refusing the whole batch would turn one stale
// entry into an empty gallery with nothing on screen to explain it. A short
// answer is a case the client has always had to handle: an id the family
// service does not know has never been in the result either.
func TestTheBatchReadDropsWorldsTheCallerMayNotReadInsteadOfFailing(t *testing.T) {
	owner := readAuthorizationOwnerAccountID
	stranger := readAuthorizationStrangerAccountID

	service, store := newReadAuthorizationFixture(t)
	unownedWorldID := createWorldOwnedBy(t, store, "unowned", nil)
	ownWorldID := createWorldOwnedBy(t, store, "own", &owner)
	strangersWorldID := createWorldOwnedBy(t, store, "stranger", &stranger)

	response, err := service.GetWorlds(context.Background(), []string{unownedWorldID, ownWorldID, strangersWorldID}, &owner)
	if err != nil {
		t.Fatalf("the batch read failed instead of filtering: %v", err)
	}

	returnedWorldIDs := map[string]bool{}
	for _, world := range response.Worlds {
		returnedWorldIDs[world.World.ID] = true
	}
	if returnedWorldIDs[strangersWorldID] {
		t.Error("the batch read returned a world belonging to another account")
	}
	if !returnedWorldIDs[unownedWorldID] {
		t.Error("the batch read dropped an unowned world, which anyone holding its id may read")
	}
	if !returnedWorldIDs[ownWorldID] {
		t.Error("the batch read dropped the caller's own world")
	}
	if len(response.Worlds) != 2 {
		t.Fatalf("the batch read returned %d worlds, want 2", len(response.Worlds))
	}
}
