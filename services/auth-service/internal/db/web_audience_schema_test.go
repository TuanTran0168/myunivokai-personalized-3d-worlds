package db

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

// This is S8-IDENTITY-001's "confirm in a test that no migration is needed".
//
// The story's claim is that turning on the `web` audience costs zero schema
// change, because Sprint 4 already paid for the identity half: `accounts.kind`
// already admits 'end_user', `roles` and `permissions` already carry an
// `audience` column constrained to admit 'web', and `accounts.token_version`
// already exists for the revocation check a 7-day access token depends on.
//
// A comment asserting that would rot the first time somebody widened a
// CHECK constraint or renamed a column. This reads the committed migrations
// and fails if any of the four facts stops being true - which is the moment
// the sprint's "zero migrations" scope note would need rewriting rather than
// the moment production starts rejecting signups.
func TestTheWebAudienceNeedsNoMigration(t *testing.T) {
	schema := readAllMigrations(t)

	requiredPatterns := []struct {
		description string
		pattern     string
	}{
		{
			description: "accounts.kind admits 'end_user', so a product signup needs no column and no constraint change",
			pattern:     `kind\s+TEXT\s+NOT NULL[^,]*CHECK\s*\(\s*kind\s+IN\s*\([^)]*'end_user'[^)]*\)\s*\)`,
		},
		{
			description: "accounts.token_version exists, which is what makes a 7-day access token revocable at all (plan section 4.4)",
			pattern:     `token_version\s+INTEGER\s+NOT NULL`,
		},
		{
			description: "an audience column constrained to admit 'web' exists, so a web-audience role or permission needs no constraint change",
			pattern:     `audience\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*audience\s+IN\s*\([^)]*'web'[^)]*\)\s*\)`,
		},
		{
			description: "refresh_tokens carries a family_id, which is what family-wide reuse detection revokes (plan section 4.2)",
			pattern:     `family_id\s+`,
		},
	}
	for _, required := range requiredPatterns {
		matcher := regexp.MustCompile(required.pattern)
		if !matcher.MatchString(schema) {
			t.Errorf("the committed migrations no longer satisfy: %s\n(no match for /%s/)", required.description, required.pattern)
		}
	}
}

// The counterpart assertion, and the one that would catch the opposite
// mistake: a migration added to this service during Phase A. The sprint scopes
// `system_settings` to Phase B, and identity itself to zero schema change, so
// a fourth migration file appearing here means the scope moved.
func TestPhaseAAddsNoMigrationToAuthService(t *testing.T) {
	const migrationFileCountAtPhaseAStart = 3

	entries, err := os.ReadDir(migrationsDirectory)
	if err != nil {
		t.Fatalf("read the migrations directory: %v", err)
	}
	sqlFileCount := 0
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			sqlFileCount++
		}
	}
	if sqlFileCount != migrationFileCountAtPhaseAStart {
		t.Fatalf("auth-service has %d migrations, expected %d at the end of Phase A - if this is S8-IDENTITY-012's system_settings table, raise the constant in the same commit",
			sqlFileCount, migrationFileCountAtPhaseAStart)
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
