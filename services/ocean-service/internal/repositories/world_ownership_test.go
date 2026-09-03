package repositories

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

// migrationsDirectory is relative to this package, which is where `go test`
// runs from. The service's own MIGRATIONS_DIR default points at the same
// folder from the repository root.
const migrationsDirectory = "../../migrations"

// This is S8-IDENTITY-007's first scenario — "the migration is instant and
// changes no existing world" — made checkable.
//
// There is no Postgres in CI, so the migration itself cannot be run here. What
// CAN be checked is the property the story actually depends on, which is a
// property of the SQL text: both columns are nullable with no default, so
// PostgreSQL 11+ treats the ADD COLUMN as metadata-only and no live table is
// rewritten. A NOT NULL or a DEFAULT slipped in later would turn a deploy that
// takes milliseconds into one that rewrites every world in production, and it
// would do it silently.
func TestTheOwnershipColumnsRewriteNoExistingWorld(t *testing.T) {
	schema := readAllMigrations(t)

	requiredPatterns := []struct {
		description string
		pattern     string
	}{
		{
			description: "owner_account_id is a bare nullable UUID, so ADD COLUMN is metadata-only and every world made before ownership existed stays valid",
			pattern:     `ALTER TABLE worlds ADD COLUMN owner_account_id UUID;`,
		},
		{
			description: "anonymous_id is a bare nullable UUID for the same reason",
			pattern:     `ALTER TABLE worlds ADD COLUMN anonymous_id UUID;`,
		},
		{
			description: "the owner index is partial, because the column is NULL on every row that exists today",
			pattern:     `CREATE INDEX idx_worlds_owner_account_id ON worlds \(owner_account_id\)\s*WHERE owner_account_id IS NOT NULL;`,
		},
		{
			description: "the anonymous index matches the claim's own predicate: the unclaimed worlds of one visitor",
			pattern:     `CREATE INDEX idx_worlds_anonymous_id ON worlds \(anonymous_id\)\s*WHERE anonymous_id IS NOT NULL AND owner_account_id IS NULL;`,
		},
	}
	for _, required := range requiredPatterns {
		matcher := regexp.MustCompile(required.pattern)
		if !matcher.MatchString(schema) {
			t.Errorf("the committed migrations no longer satisfy: %s\n(no match for /%s/)", required.description, required.pattern)
		}
	}

	// Decision 16, in the one form that can be checked: no backfill. A world
	// made before this plan is anonymous and unclaimable for ever, because
	// nobody can prove they made it — an UPDATE here would be somebody
	// guessing on their behalf.
	backfillPattern := regexp.MustCompile(`(?is)UPDATE\s+worlds\s+SET[^;]*\b(owner_account_id|anonymous_id)\b`)
	if backfillPattern.MatchString(schema) {
		t.Error("a migration backfills ownership. Decision 16 says NULL is the answer: a pre-plan world is anonymous and unclaimable for ever, because nobody can prove they made it")
	}

	// accounts live in another database on another host, so this foreign key
	// cannot exist. If one is ever written it will not fail at migration time
	// on a machine where both databases happen to be the same one.
	foreignKeyPattern := regexp.MustCompile(`(?i)owner_account_id[^;]*REFERENCES`)
	if foreignKeyPattern.MatchString(schema) {
		t.Error("owner_account_id has grown a REFERENCES clause. Accounts live in another database on another host; the Ed25519 signature the gateway verified is the existence proof, not a foreign key")
	}
}

// `owner_account_id` is write-once in v1: every write carries
// `WHERE owner_account_id IS NULL`, and there is no transfer endpoint. That
// removes an entire class of race — two claims for the same world, a claim
// racing a create — rather than resolving it.
//
// Today this test finds nothing to check, because nothing writes the column
// yet: the claim (S8-IDENTITY-011) is what will. That is deliberate. The guard
// is written BEFORE the write it guards, because the commit that adds the
// write is reviewed for what it does, and this is the thing it would forget.
func TestAnOwnerIsNeverOverwritten(t *testing.T) {
	rawStringLiteralPattern := regexp.MustCompile("(?s)`([^`]*)`")
	ownerAssignmentPattern := regexp.MustCompile(`(?is)\bSET\b[^;]*\bowner_account_id\s*=`)
	writeOnceGuardPattern := regexp.MustCompile(`(?is)\bowner_account_id\s+IS\s+NULL\b`)

	for _, path := range packageSourceFiles(t) {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, literal := range rawStringLiteralPattern.FindAllStringSubmatch(string(contents), -1) {
			statement := literal[1]
			if !ownerAssignmentPattern.MatchString(statement) {
				continue
			}
			if !writeOnceGuardPattern.MatchString(statement) {
				t.Errorf("%s assigns owner_account_id without a `WHERE owner_account_id IS NULL` guard in the same statement:\n%s\n\nOwnership is write-once in v1 and there is no transfer endpoint. Two claims for the same world must leave the first one winning.", path, strings.TrimSpace(statement))
			}
		}
	}
}

// The story's last scenario: a world that predates ownership, both columns
// NULL, stays mutable by anyone holding its id. It is the half that is easy to
// break while adding the half that is easy to remember — an ownership check
// written as "the caller must equal the owner" refuses every world in
// production, because every world in production has no owner.
//
// It passes trivially today, and that is exactly why it is written now: it is
// the assertion S8-IDENTITY-008 must not break when it adds the predicate.
func TestAWorldWithNoOwnerStaysMutable(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()

	bundle, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-made-before-ownership-existed", Visibility: "private"},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.World.OwnerAccountID != nil || bundle.World.AnonymousID != nil {
		t.Fatalf("a world created with no identity gained one: owner=%v anonymous=%v", bundle.World.OwnerAccountID, bundle.World.AnonymousID)
	}

	addedVariant, err := store.AddVariant(ctx, bundle.World.ID, models.WorldVariant{ID: "variant-2", VariantNo: 2, Seed: "seed-2"})
	if err != nil {
		t.Fatalf("add a variant to an unowned world: %v", err)
	}
	if _, err := store.SelectVariant(ctx, bundle.World.ID, addedVariant.ID); err != nil {
		t.Fatalf("select a variant on an unowned world: %v", err)
	}
	if _, err := store.PublishWorld(ctx, bundle.World.ID, "share-slug-1"); err != nil {
		t.Fatalf("publish an unowned world: %v", err)
	}
}

// The other direction: a world created WITH an identity keeps it, and keeps it
// separately. The two columns answer different questions — "is this world
// anonymous?" and "which anonymous visitor?" — so a store that collapsed them
// into one would pass every test above and lose the claim.
func TestAWorldKeepsTheIdentityItWasCreatedWith(t *testing.T) {
	store := NewMemoryStore()
	ctx := context.Background()
	ownerAccountID := "11111111-1111-1111-1111-111111111111"
	anonymousID := "22222222-2222-2222-2222-222222222222"

	created, err := store.CreateWorld(ctx,
		models.World{SourceJobID: "job-1", Visibility: "private", OwnerAccountID: &ownerAccountID, AnonymousID: &anonymousID},
		models.WorldVariant{ID: "variant-1", VariantNo: 1, Seed: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	readBack, err := store.GetWorld(ctx, created.World.ID)
	if err != nil {
		t.Fatal(err)
	}
	if readBack.World.OwnerAccountID == nil || *readBack.World.OwnerAccountID != ownerAccountID {
		t.Errorf("owner account id read back as %v, want %s", readBack.World.OwnerAccountID, ownerAccountID)
	}
	if readBack.World.AnonymousID == nil || *readBack.World.AnonymousID != anonymousID {
		t.Errorf("anonymous id read back as %v, want %s", readBack.World.AnonymousID, anonymousID)
	}
}

func packageSourceFiles(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read the package directory: %v", err)
	}
	var paths []string
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		paths = append(paths, name)
	}
	if len(paths) == 0 {
		t.Fatal("no source files were found; this test would otherwise pass by finding nothing to contradict")
	}
	return paths
}

func readAllMigrations(t *testing.T) string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(migrationsDirectory, "*.sql"))
	if err != nil {
		t.Fatalf("glob the migrations directory: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("no migration files were found; this test would otherwise pass by finding nothing to contradict")
	}
	var combined strings.Builder
	for _, path := range paths {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		combined.Write(contents)
		combined.WriteString("\n")
	}
	return combined.String()
}
