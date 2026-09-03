package repositories

import (
	"regexp"
	"strings"
	"testing"
)

// There is no Postgres in CI, so what the account's world list can be checked
// against is the SQL text. These are the four properties the story and the
// plan depend on, each of which fails silently if it breaks: an OFFSET page
// that repeats a world while somebody is scrolling, a missing owner predicate
// that returns everybody's worlds, a tie-break that loses a row at a page
// boundary, and a page that includes jobs which never produced a world.

func TestTheWorldListPagesByKeysetAndNeverByOffset(t *testing.T) {
	source := readRepositorySource(t)
	offsetPattern := regexp.MustCompile(`(?is)FROM generation_jobs[^` + "`" + `]*\bOFFSET\b`)
	if offsetPattern.MatchString(source) {
		t.Error("a world-list query uses OFFSET. Section 8: pagination is keyset, never OFFSET — with OFFSET, a world created while somebody is paging shifts every later row and repeats one they have already seen")
	}
}

func TestTheWorldListAsksForOneAccountsWorldsOnly(t *testing.T) {
	source := readRepositorySource(t)
	for _, statement := range worldListStatements(t, source) {
		if !strings.Contains(statement, "p.owner_account_id = $1") {
			t.Errorf("a world-list statement does not filter on one owner:\n%s\n\nWithout it this query returns every account's worlds", strings.TrimSpace(statement))
		}
		if strings.Contains(statement, "anonymous_id") {
			t.Errorf("a world-list statement reads anonymous_id:\n%s\n\nThere is no server-side list for somebody who cannot prove who they are — an anonymous visitor's list is their browser's localStorage", strings.TrimSpace(statement))
		}
	}
}

// The job id is in the ORDER BY as well as the cursor, and both halves have to
// be there: two jobs can share a created_at because a retry writes its row
// with the same statement's clock, and without the tie-break a page boundary
// landing between them repeats one world or drops one.
func TestTheWorldListOrdersByBothHalvesOfItsCursor(t *testing.T) {
	source := readRepositorySource(t)
	statements := worldListStatements(t, source)
	orderPattern := regexp.MustCompile(`(?is)ORDER BY j\.created_at DESC, j\.job_id DESC`)
	for _, statement := range statements {
		if !orderPattern.MatchString(statement) {
			t.Errorf("a world-list statement does not order by created_at then job_id:\n%s", strings.TrimSpace(statement))
		}
	}

	// And the cursor predicate is a ROW VALUE comparison. Written as two ANDed
	// comparisons it would drop every row sharing the cursor's timestamp,
	// which is precisely the tie the job id exists to break.
	rowValuePattern := regexp.MustCompile(`\(j\.created_at, j\.job_id\) < \(\$3, \$4\)`)
	if !rowValuePattern.MatchString(source) {
		t.Error("the cursor predicate is not a row-value comparison. `created_at < $3 AND job_id < $4` silently drops rows that share the cursor's timestamp")
	}
}

func TestTheWorldListSkipsJobsThatNeverProducedAWorld(t *testing.T) {
	source := readRepositorySource(t)
	for _, statement := range worldListStatements(t, source) {
		if !strings.Contains(statement, "j.world_id IS NOT NULL") {
			t.Errorf("a world-list statement does not require a world:\n%s\n\nA queued or failed job has no world to show, and the partial index that serves this query has the same predicate", strings.TrimSpace(statement))
		}
	}
}

// The first page has to be a separate statement from a later one, and this is
// why: `(j.created_at, j.job_id) < (NULL, NULL)` evaluates to NULL in Postgres
// and matches no rows at all. One statement with a nullable cursor would
// answer every first request with an empty page — which reads as "this account
// has no worlds" rather than as a bug.
func TestTheFirstPageDoesNotGoThroughTheCursorPredicate(t *testing.T) {
	source := readRepositorySource(t)
	statements := worldListStatements(t, source)
	const expectedStatementCount = 2
	if len(statements) != expectedStatementCount {
		t.Fatalf("found %d world-list statements, expected %d (one for the first page, one for a page after a cursor)",
			len(statements), expectedStatementCount)
	}
	statementsWithACursor := 0
	for _, statement := range statements {
		if strings.Contains(statement, "j.job_id) < (") {
			statementsWithACursor++
		}
	}
	if statementsWithACursor != 1 {
		t.Fatalf("%d of %d statements carry the cursor predicate, expected exactly 1", statementsWithACursor, len(statements))
	}
}

// worldListStatements finds the SQL that answers the account's world list, by
// the one thing every such statement must contain. Finding none fails, so this
// file cannot pass by looking at the wrong code.
func worldListStatements(t *testing.T, source string) []string {
	t.Helper()
	rawStringLiteralPattern := regexp.MustCompile("(?s)`([^`]*)`")
	statements := make([]string, 0, 2)
	for _, literal := range rawStringLiteralPattern.FindAllStringSubmatch(source, -1) {
		statement := literal[1]
		// Discriminated by the paging clause rather than by the owner
		// predicate, so that the owner assertion above is not circular: a
		// statement selected BECAUSE it filters on an owner could hardly fail
		// to filter on one. Every world-list statement pages; no other
		// statement over these two tables does.
		if !strings.Contains(statement, "FROM generation_jobs j") || !strings.Contains(statement, "LIMIT $2") {
			continue
		}
		statements = append(statements, statement)
	}
	if len(statements) == 0 {
		t.Fatal("no world-list statement was found; this file would otherwise pass by finding nothing to contradict")
	}
	return statements
}
