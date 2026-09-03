package repositories

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// migrationsDirectory is relative to this package, which is where `go test`
// runs from. The service's own MIGRATIONS_DIR default points at the same
// folder from the repository root.
const migrationsDirectory = "../../migrations"

// `dna-service` gains the same two columns the family services do, and for a
// reason no family service can serve: it is the only service that knows which
// FAMILIES a visitor used, which is what narrows the claim's fan-out, and it
// is where the account's own world list is read from.
//
// There is no Postgres in CI, so what is checked here is the property of the
// SQL text the story depends on — nullable, no default, no backfill — rather
// than the result of running it. See the same test in each family service.
func TestTheProfileOwnershipColumnsRewriteNoExistingProfile(t *testing.T) {
	schema := readAllMigrations(t)

	requiredPatterns := []struct {
		description string
		pattern     string
	}{
		{
			description: "owner_account_id is a bare nullable UUID, so ADD COLUMN is metadata-only and every profile made before ownership existed stays valid",
			pattern:     `ALTER TABLE profiles ADD COLUMN owner_account_id UUID;`,
		},
		{
			description: "anonymous_id is a bare nullable UUID for the same reason",
			pattern:     `ALTER TABLE profiles ADD COLUMN anonymous_id UUID;`,
		},
		{
			description: "the owner index is partial, because the column is NULL on every row that exists today",
			pattern:     `CREATE INDEX idx_profiles_owner_account_id ON profiles \(owner_account_id\)\s*WHERE owner_account_id IS NOT NULL;`,
		},
		{
			description: "the anonymous index matches the claim's own predicate, which runs against this table on every signup",
			pattern:     `CREATE INDEX idx_profiles_anonymous_id ON profiles \(anonymous_id\)\s*WHERE anonymous_id IS NOT NULL AND owner_account_id IS NULL;`,
		},
		{
			description: "the keyset index serves the account's world list: newest first, over the jobs that produced a world, with job_id breaking a timestamp tie so a page boundary is stable",
			pattern:     `CREATE INDEX idx_generation_jobs_world_keyset\s*ON generation_jobs \(profile_id, created_at DESC, job_id DESC\)\s*WHERE world_id IS NOT NULL;`,
		},
	}
	for _, required := range requiredPatterns {
		matcher := regexp.MustCompile(required.pattern)
		if !matcher.MatchString(schema) {
			t.Errorf("the committed migrations no longer satisfy: %s\n(no match for /%s/)", required.description, required.pattern)
		}
	}

	backfillPattern := regexp.MustCompile(`(?is)UPDATE\s+profiles\s+SET[^;]*\b(owner_account_id|anonymous_id)\b`)
	if backfillPattern.MatchString(schema) {
		t.Error("a migration backfills ownership. Decision 16 says NULL is the answer: a pre-plan profile is anonymous and unclaimable for ever, because nobody can prove they made it")
	}

	foreignKeyPattern := regexp.MustCompile(`(?i)owner_account_id[^;]*REFERENCES`)
	if foreignKeyPattern.MatchString(schema) {
		t.Error("owner_account_id has grown a REFERENCES clause. Accounts live in another database on another host; the Ed25519 signature the gateway verified is the existence proof, not a foreign key")
	}
}

// The same write-once ratchet the family services carry, for the same reason:
// the claim (S8-IDENTITY-011) updates this table first and fans out from it,
// so a claim replayed from a second device must find zero rows to update
// rather than reassigning a profile that already has an owner.
//
// It finds nothing to check today. It is written before the write it guards
// because the commit adding that write is reviewed for what it does, and this
// is the thing it would forget.
func TestAProfileOwnerIsNeverOverwritten(t *testing.T) {
	rawStringLiteralPattern := regexp.MustCompile("(?s)`([^`]*)`")
	ownerAssignmentPattern := regexp.MustCompile(`(?is)\bSET\b[^;]*\bowner_account_id\s*=`)
	writeOnceGuardPattern := regexp.MustCompile(`(?is)\bowner_account_id\s+IS\s+NULL\b`)

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read the package directory: %v", err)
	}
	sourceFileCount := 0
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		sourceFileCount++
		contents, readError := os.ReadFile(name)
		if readError != nil {
			t.Fatalf("read %s: %v", name, readError)
		}
		for _, literal := range rawStringLiteralPattern.FindAllStringSubmatch(string(contents), -1) {
			statement := literal[1]
			if !ownerAssignmentPattern.MatchString(statement) {
				continue
			}
			if !writeOnceGuardPattern.MatchString(statement) {
				t.Errorf("%s assigns owner_account_id without a `WHERE owner_account_id IS NULL` guard in the same statement:\n%s\n\nOwnership is write-once in v1 and there is no transfer endpoint. A claim replayed from a second device must update zero rows.", name, strings.TrimSpace(statement))
			}
		}
	}
	if sourceFileCount == 0 {
		t.Fatal("no source files were found; this test would otherwise pass by finding nothing to contradict")
	}
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
