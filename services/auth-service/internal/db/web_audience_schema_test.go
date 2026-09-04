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
		{
			// The column is nullable BECAUSE of this clause, and the pair is
			// the decision: a policy number outlives the staff member who set
			// it. account_profiles cascades from the same parent table, so the
			// difference here is a choice rather than a default, and a
			// CASCADE would let removing a staff account silently revert the
			// platform's quota.
			description: "system_settings.updated_by_account_id sets itself to NULL rather than cascading, so deleting a staff account cannot delete a policy value",
			pattern:     `updated_by_account_id\s+UUID\s+REFERENCES\s+accounts\(id\)\s+ON DELETE SET NULL`,
		},
		{
			// One row per key, enforced by the database rather than by the
			// upsert being careful: two rows for one setting would make the
			// effective value depend on which one was read.
			description: "system_settings.setting_key is the primary key, so a setting cannot have two values",
			pattern:     `setting_key\s+TEXT\s+PRIMARY KEY`,
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
// mistake: a migration this service gained without anybody deciding to give it
// one. Identity itself cost zero schema change, and the count below is
// therefore a deliberate ratchet rather than a description - raising it is the
// commit where somebody chose to pay for a table.
//
// It has been raised twice.
//
//   - 000004_account_profiles.sql is the account's own page (owner request,
//     2026-09-02).
//   - 000005_system_settings.sql is S8-IDENTITY-012's settings table, which
//     this comment predicted by name. It bought nine policy numbers an
//     operator can change without a deploy, and it is the last table §9.3
//     asks for: batch 2 adds ROWS to it, not tables.
//
// Both raises happened in the commit that added the migration, which is
// exactly the protocol this test asks for.
func TestAuthServiceGainsNoUnplannedMigration(t *testing.T) {
	const expectedMigrationFileCount = 5

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
	if sqlFileCount != expectedMigrationFileCount {
		t.Fatalf("auth-service has %d migrations, expected %d - if the new one is deliberate, raise the constant in the same commit and say in this comment what it bought",
			sqlFileCount, expectedMigrationFileCount)
	}
}

// The account's own page rests on schema facts the same way the web audience
// does, and the same argument applies to asserting them here: a comment
// claiming the profile table cascades would rot the first time somebody
// rewrote the migration.
//
// The nickname absence is the one worth pinning. accounts.name is the single
// name an account has - projected into CreationDefaults.Nickname on read and
// written back on update - and a nickname column appearing in this table would
// silently give the header menu and the create form two different names to
// disagree with each other.
func TestTheAccountProfileTableHoldsItsInvariants(t *testing.T) {
	schema := readAllMigrations(t)

	profileTablePattern := regexp.MustCompile(`(?s)CREATE TABLE account_profiles\s*\((.*?)\n\);`)
	tableBody := profileTablePattern.FindStringSubmatch(schema)
	if tableBody == nil {
		t.Fatal("account_profiles is not in the committed migrations; the account page has no table to read")
	}
	definition := tableBody[1]

	requiredPatterns := []struct {
		description string
		pattern     string
	}{
		{
			description: "the profile is keyed on the account and cascades with it, so no profile can outlive the account it describes",
			pattern:     `account_id\s+UUID\s+PRIMARY KEY\s+REFERENCES\s+accounts\(id\)\s+ON DELETE CASCADE`,
		},
		{
			description: "gender is constrained to the contracts vocabulary, including the empty default that means unanswered",
			pattern:     `gender\s+TEXT\s+NOT NULL\s+DEFAULT\s+''\s+CHECK\s*\(\s*gender\s+IN\s*\(\s*''[^)]*'prefer_not_to_say'\s*\)\s*\)`,
		},
		{
			description: "the create-form toggle defaults to on, so a profile somebody filled in is used without a second action",
			pattern:     `autofill_create_form\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+TRUE`,
		},
	}
	for _, required := range requiredPatterns {
		matcher := regexp.MustCompile(required.pattern)
		if !matcher.MatchString(definition) {
			t.Errorf("account_profiles no longer satisfies: %s\n(no match for /%s/)", required.description, required.pattern)
		}
	}

	// Every OTHER column may come and go. This one may not appear.
	if regexp.MustCompile(`(?m)^\s*nickname\s`).MatchString(definition) {
		t.Error("account_profiles has grown a nickname column. The nickname is accounts.name, projected into CreationDefaults on read - two columns means the header menu and the create form can greet the same person differently")
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
