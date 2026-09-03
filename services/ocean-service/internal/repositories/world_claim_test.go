package repositories

import (
	"context"
	"os"
	"regexp"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

const (
	claimTestAccountID       = "11111111-1111-1111-1111-111111111111"
	claimTestSecondAccountID = "44444444-4444-4444-4444-444444444444"
	claimTestAnonymousID     = "22222222-2222-2222-2222-222222222222"
	claimTestOtherVisitorID  = "55555555-5555-5555-5555-555555555555"
	claimTestJobID           = "job-claim-1"
)

func claimEnvelope(accountID, anonymousID string) contracts.Envelope[contracts.WorldClaimData] {
	return contracts.NewEnvelope(claimTestJobID, contracts.WorldClaimData{AccountID: accountID, AnonymousID: anonymousID})
}

// createWorldForVisitor stores one world as the compose path would: an owner,
// an anonymous id, or neither.
func createWorldForVisitor(t *testing.T, store *MemoryStore, sourceJobID string, ownerAccountID, anonymousID *string) string {
	t.Helper()
	bundle, err := store.CreateWorld(context.Background(),
		models.World{SourceJobID: sourceJobID, Visibility: "private", OwnerAccountID: ownerAccountID, AnonymousID: anonymousID},
		models.WorldVariant{ID: "variant-" + sourceJobID, VariantNo: 1, Seed: "seed-" + sourceJobID})
	if err != nil {
		t.Fatal(err)
	}
	return bundle.World.ID
}

// The claim moves exactly the worlds one anonymous visitor made, and nothing
// else in the table.
//
// The three worlds it must NOT touch are the interesting ones: another
// visitor's anonymous world, somebody else's owned world, and a world with no
// identity at all - which is every world made before this plan existed, and
// which decision 16 leaves unclaimable for ever because nobody can prove they
// made it.
func TestAClaimMovesOnlyThatVisitorsAnonymousWorlds(t *testing.T) {
	anonymousID := claimTestAnonymousID
	otherVisitorID := claimTestOtherVisitorID
	strangerAccountID := claimTestSecondAccountID
	store := NewMemoryStore()

	claimable := createWorldForVisitor(t, store, "job-1", nil, &anonymousID)
	alsoClaimable := createWorldForVisitor(t, store, "job-2", nil, &anonymousID)
	anotherVisitors := createWorldForVisitor(t, store, "job-3", nil, &otherVisitorID)
	strangersOwned := createWorldForVisitor(t, store, "job-4", &strangerAccountID, nil)
	prePlan := createWorldForVisitor(t, store, "job-5", nil, nil)

	claimedCount, err := store.ClaimWorlds(context.Background(), claimEnvelope(claimTestAccountID, anonymousID))
	if err != nil {
		t.Fatal(err)
	}
	if claimedCount != 2 {
		t.Fatalf("claimed %d worlds, want 2", claimedCount)
	}
	for _, worldID := range []string{claimable, alsoClaimable} {
		world := store.worlds[worldID]
		if world.OwnerAccountID == nil || *world.OwnerAccountID != claimTestAccountID {
			t.Errorf("world %s owner = %v, want the claiming account", worldID, world.OwnerAccountID)
		}
		// The anonymous id is a bearer credential: whoever holds it owns the
		// worlds it names. Once an account owns them it is a spare key with
		// nothing left to unlock, sitting in a JS-readable cookie.
		if world.AnonymousID != nil {
			t.Errorf("world %s still carries anonymous id %q after being claimed", worldID, *world.AnonymousID)
		}
	}
	if world := store.worlds[anotherVisitors]; world.OwnerAccountID != nil {
		t.Error("another visitor's anonymous world was claimed. One browser's cookie would take a different browser's worlds")
	}
	if world := store.worlds[strangersOwned]; *world.OwnerAccountID != strangerAccountID {
		t.Error("an owned world changed hands. Ownership is write-once in v1 and there is no transfer endpoint")
	}
	if world := store.worlds[prePlan]; world.OwnerAccountID != nil || world.AnonymousID != nil {
		t.Error("a world with no identity was claimed. Decision 16: a pre-plan world is anonymous and unclaimable for ever, because nobody can prove they made it")
	}
}

// Claiming twice, and from two devices, both change nothing the second time.
//
// One test rather than two, because they are the same guard seen from two
// directions: a replayed JetStream delivery and a second account presented
// with the same anonymous id are both refused by `owner_account_id IS NULL`.
// The second is the one that matters - it is what makes the anonymous id safe
// to keep in a cookie at all.
func TestAClaimIsAppliedExactlyOnceForEver(t *testing.T) {
	anonymousID := claimTestAnonymousID
	store := NewMemoryStore()
	worldID := createWorldForVisitor(t, store, "job-1", nil, &anonymousID)

	firstCount, err := store.ClaimWorlds(context.Background(), claimEnvelope(claimTestAccountID, anonymousID))
	if err != nil || firstCount != 1 {
		t.Fatalf("first claim = %d, %v; want 1, nil", firstCount, err)
	}
	replayedCount, err := store.ClaimWorlds(context.Background(), claimEnvelope(claimTestAccountID, anonymousID))
	if err != nil {
		t.Fatalf("a replayed claim must not error: %v", err)
	}
	if replayedCount != 0 {
		t.Errorf("a replayed claim moved %d worlds, want 0", replayedCount)
	}
	secondDeviceCount, err := store.ClaimWorlds(context.Background(), claimEnvelope(claimTestSecondAccountID, anonymousID))
	if err != nil {
		t.Fatalf("a second device's claim must not error: %v", err)
	}
	if secondDeviceCount != 0 {
		t.Errorf("a second account claimed %d already-claimed worlds, want 0", secondDeviceCount)
	}
	if world := store.worlds[worldID]; *world.OwnerAccountID != claimTestAccountID {
		t.Errorf("owner = %q, want the FIRST claimer. Whoever claims first keeps it; there is no transfer in v1", *world.OwnerAccountID)
	}
}

// A claim emits nothing and bumps no revision, which is the correction Phase B
// made to plan section 7.
//
// The snapshot analytics reads carries no owner (decision 4b), so the
// `world.changed` a claim would publish is byte-identical to the last one. It
// would make the event stop meaning "something you can see changed", waking a
// consumer added later for nothing and rewriting identical values in the read
// model.
func TestAClaimEmitsNoEventAndBumpsNoRevision(t *testing.T) {
	anonymousID := claimTestAnonymousID
	store := NewMemoryStore()
	worldID := createWorldForVisitor(t, store, "job-1", nil, &anonymousID)

	revisionBeforeClaim := store.worlds[worldID].Revision
	outboxBeforeClaim, err := store.PendingOutbox(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimWorlds(context.Background(), claimEnvelope(claimTestAccountID, anonymousID)); err != nil {
		t.Fatal(err)
	}
	outboxAfterClaim, err := store.PendingOutbox(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(outboxAfterClaim) != len(outboxBeforeClaim) {
		t.Errorf("the claim staged %d outbox message(s), want 0", len(outboxAfterClaim)-len(outboxBeforeClaim))
	}
	if store.worlds[worldID].Revision != revisionBeforeClaim {
		t.Errorf("revision moved from %d to %d. Revision means the world changed in a way somebody can see; ownership is not on the snapshot at all", revisionBeforeClaim, store.worlds[worldID].Revision)
	}
}

// The guard, checked in the SQL that ships rather than only in the mirror
// above. There is no Postgres in CI, so the statement somebody has to be able
// to check by reading it is checked by reading it.
func TestTheClaimStatementCarriesTheWriteOnceGuard(t *testing.T) {
	source, err := os.ReadFile("postgres_store.go")
	if err != nil {
		t.Fatalf("read postgres_store.go: %v", err)
	}
	statementPattern := regexp.MustCompile("(?is)UPDATE\\s+worlds\\s+SET[^;`]*owner_account_id\\s*=[^`]*")
	statements := statementPattern.FindAllString(string(source), -1)
	if len(statements) != 1 {
		t.Fatalf("found %d statements assigning worlds.owner_account_id, want exactly 1. A second write to that column needs its own reading of the write-once rule, not this test's", len(statements))
	}
	statement := statements[0]
	if !regexp.MustCompile(`(?is)owner_account_id\s+IS\s+NULL`).MatchString(statement) {
		t.Errorf("the claim has no write-once guard:\n%s\n\nWithout it a second device's claim would take worlds the first device already owns, and a replayed JetStream delivery would reassign them", strings.TrimSpace(statement))
	}
	if !regexp.MustCompile(`(?is)anonymous_id\s*=\s*NULL`).MatchString(statement) {
		t.Errorf("the claim does not clear anonymous_id:\n%s\n\nIt is a bearer credential in a JS-readable cookie; once an account owns these worlds it unlocks nothing and should not exist", strings.TrimSpace(statement))
	}
	if regexp.MustCompile(`(?is)revision\s*=`).MatchString(statement) {
		t.Errorf("the claim bumps revision:\n%s\n\nRevision drives world.changed, and a claim changes nothing a reader of that event could see", strings.TrimSpace(statement))
	}
}
