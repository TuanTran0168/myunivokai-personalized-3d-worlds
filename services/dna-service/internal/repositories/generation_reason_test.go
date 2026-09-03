package repositories

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// readRepositorySource concatenates every non-test source file in this
// package, for the assertions that are about the SQL this package contains
// rather than about the result of running it. There is no Postgres in CI, so
// the text is the only thing available to check.
func readRepositorySource(t *testing.T) string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read the package directory: %v", err)
	}
	var combined strings.Builder
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
		combined.Write(contents)
		combined.WriteString("\n")
	}
	if sourceFileCount == 0 {
		t.Fatal("no source files were found; a test reading this would otherwise pass by finding nothing to contradict")
	}
	return combined.String()
}

// The reason enum is declared twice — once in Go, once as a CHECK constraint
// on generation_jobs — and there is no Postgres in CI to catch a disagreement.
// This is the ratchet that makes the duplication safe.
//
// It is the same trap a new world family has: `contracts.WorldFamily` gains a
// value, every Go test passes, and the family CHECK on two tables is the thing
// nobody edits. A reason the code produces and the column refuses would roll
// back a transaction that had already generated a valid world.
func TestTheGenerationReasonCheckAdmitsEveryDeclaredReason(t *testing.T) {
	schema := readAllMigrations(t)
	checkConstraintPattern := regexp.MustCompile(`(?is)generation_reason\s+TEXT\s*CHECK\s*\(\s*generation_reason\s+IN\s*\(([^)]*)\)`)
	match := checkConstraintPattern.FindStringSubmatch(schema)
	if match == nil {
		t.Fatal("generation_jobs.generation_reason has no CHECK constraint listing its permitted values, so any string a service writes would land in the column")
	}
	admittedValues := match[1]
	for _, declaredReason := range contracts.DeclaredGenerationReasons() {
		quotedReason := fmt.Sprintf("'%s'", declaredReason)
		if !strings.Contains(admittedValues, quotedReason) {
			t.Errorf("contracts declares the reason %q and the generation_jobs CHECK does not admit it: a world produced that way would fail to store", declaredReason)
		}
	}
	// The other direction too: a value the column admits and the contract does
	// not declare is a reason the web app has no branch for, which reaches a
	// visitor as silence where a sentence was owed.
	admittedValuePattern := regexp.MustCompile(`'([a-z_]+)'`)
	for _, admittedMatch := range admittedValuePattern.FindAllStringSubmatch(admittedValues, -1) {
		if !contracts.GenerationReason(admittedMatch[1]).Valid() {
			t.Errorf("the generation_jobs CHECK admits %q, which contracts does not declare", admittedMatch[1])
		}
	}
}

// The two columns are additive over a table that already holds every job this
// platform has ever run. There is no Postgres in CI, so what is asserted is
// the property of the SQL text the story depends on: nullable, no default, no
// backfill, so ADD COLUMN stays metadata-only and every existing job stays
// valid with no reason at all.
func TestTheGenerationReasonColumnsRewriteNoExistingJob(t *testing.T) {
	schema := readAllMigrations(t)

	requiredPatterns := []struct {
		description string
		pattern     string
	}{
		{
			description: "generation_reason is nullable with no DEFAULT, because NULL is the honest value for every job that already exists and for every failed job",
			pattern:     `ALTER TABLE generation_jobs ADD COLUMN generation_reason TEXT\s*CHECK`,
		},
		{
			description: "daily_ai_generation_limit is nullable with no DEFAULT, for the same reason",
			pattern:     `ALTER TABLE generation_jobs ADD COLUMN daily_ai_generation_limit INTEGER\s*CHECK \(daily_ai_generation_limit >= 0\)`,
		},
	}
	for _, required := range requiredPatterns {
		if !regexp.MustCompile(required.pattern).MatchString(schema) {
			t.Errorf("the committed migrations no longer satisfy: %s\n(no match for /%s/)", required.description, required.pattern)
		}
	}

	defaultClausePattern := regexp.MustCompile(`(?is)ADD COLUMN (generation_reason|daily_ai_generation_limit)[^;]*\bDEFAULT\b`)
	if defaultClausePattern.MatchString(schema) {
		t.Error("one of the quota columns has grown a DEFAULT. A default would rewrite every existing row and would claim a reason for worlds produced before the quota existed")
	}

	backfillPattern := regexp.MustCompile(`(?is)UPDATE\s+generation_jobs\s+SET[^;]*\b(generation_reason|daily_ai_generation_limit)\b`)
	if backfillPattern.MatchString(schema) {
		t.Error("a migration backfills a generation reason. Nothing knows how a world made before the quota was produced, and a guess would be shown to its maker as fact")
	}
}

// A world carries no tier marker, for ever, to anybody (section 9.1). The
// reason lives on the JOB, and the difference is what the friend who opens a
// share link sees: nothing, because they hit no limit.
func TestNoWorldTableLearnsTheGenerationReason(t *testing.T) {
	schema := readAllMigrations(t)
	worldColumnPattern := regexp.MustCompile(`(?is)ALTER TABLE\s+(worlds|world_variants)\s+ADD COLUMN[^;]*\bgeneration_reason\b`)
	if worldColumnPattern.MatchString(schema) {
		t.Error("a world table gained the generation reason. Section 9.1: the truth is owed once, to the person who hit the limit, not permanently to everyone who opens their share link")
	}
}

// The reason has to survive a JetStream redelivery, which means it must be
// written in the same statement as the DNA version rather than in a second
// UPDATE that a crash can lose.
func TestTheGenerationReasonIsWrittenWithTheDNAVersion(t *testing.T) {
	source := readRepositorySource(t)
	combinedUpdatePattern := regexp.MustCompile(`(?is)UPDATE generation_jobs\s*SET dna_version_id=\$2[^` + "`" + `]*generation_reason=\$3[^` + "`" + `]*daily_ai_generation_limit=\$4`)
	if !combinedUpdatePattern.MatchString(source) {
		t.Error("the generation reason is no longer written in the same statement as the DNA version. Split across two statements, a crash between them leaves a world whose maker is told nothing about why it looks the way it does")
	}
}
