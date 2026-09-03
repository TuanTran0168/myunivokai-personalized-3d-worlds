package repositories

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// claimStatementPattern finds the one statement in this package that assigns
// an owner. There is exactly one, and the tests below are about what else that
// same statement has to say.
var claimStatementPattern = regexp.MustCompile(`(?is)UPDATE\s+profiles\s+SET[^;` + "`" + `]*owner_account_id\s*=[^` + "`" + `]*`)

func claimStatement(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile("postgres_store.go")
	if err != nil {
		t.Fatalf("read postgres_store.go: %v", err)
	}
	matches := claimStatementPattern.FindAllString(string(source), -1)
	if len(matches) != 1 {
		t.Fatalf("found %d statements assigning owner_account_id, want exactly 1. The claim is the only write to that column in v1 - a second one needs its own reading of these rules, not this test's", len(matches))
	}
	return matches[0]
}

// Claiming clears the anonymous id in the same statement that sets the owner.
//
// Not tidiness. The anonymous id is a bearer credential: whoever holds it owns
// the worlds it names (section 7). Leaving it on a claimed profile would leave
// a second, weaker key to an account's worlds lying in a JS-readable cookie
// with no expiry anyone tracks — and the `owner_account_id IS NULL` guard
// means it could never be used to claim them again, so it would be a
// credential with no purpose and a real exposure.
func TestClaimingClearsTheAnonymousIDItMatchedOn(t *testing.T) {
	statement := claimStatement(t)
	if !regexp.MustCompile(`(?is)anonymous_id\s*=\s*NULL`).MatchString(statement) {
		t.Errorf("the claim does not clear anonymous_id:\n%s\n\nWhoever holds an anonymous id owns the worlds it names. Once an account owns them, that id is a spare key to somebody's account with nothing left to unlock", strings.TrimSpace(statement))
	}
	if !regexp.MustCompile(`(?is)WHERE\s+anonymous_id\s*=\s*\$\d`).MatchString(statement) {
		t.Errorf("the claim does not select rows by anonymous_id:\n%s\n\nClaiming by anything else - a world id, a profile id - is what section 7 refuses: a world id is the URL a visitor sends to a friend, so it is not a thing to prove ownership with", strings.TrimSpace(statement))
	}
}

// The claim publishes to a family's CLAIM subject and to nothing else.
//
// Corrected during Phase B: plan section 7 had the claim emitting the existing
// `world.changed` event. It must emit no event at all. Analytics is untouched
// by ownership (decision 4b) and the snapshot deliberately carries no owner, so
// the event a claim would publish is byte-identical to the last one — it would
// make `world.changed` stop meaning "something you can see changed" and wake a
// future consumer for nothing.
func TestTheClaimStagesOnlyFamilyClaimCommandsAndNoEvent(t *testing.T) {
	source, err := os.ReadFile("postgres_store.go")
	if err != nil {
		t.Fatalf("read postgres_store.go: %v", err)
	}
	claimMethod := methodBody(t, string(source), "func (store *PostgresStore) ClaimWorlds")
	if !strings.Contains(claimMethod, "family.ClaimCommandSubject()") {
		t.Error("the claim no longer resolves a family claim subject. The fan-out is the reason this method is in dna-service rather than the gateway: generation_jobs is the only place that records which families a visitor used")
	}
	forbiddenSubjectPattern := regexp.MustCompile(`(?i)(CompletedEventSubject|FailedEventSubject|GeneratedEventSubject|world\.changed)`)
	if forbiddenSubject := forbiddenSubjectPattern.FindString(claimMethod); forbiddenSubject != "" {
		t.Errorf("the claim stages %q. A claim changes nothing a reader of an event could see: the snapshot carries no owner, so the event would be byte-identical to the last one and would make world.changed stop meaning anything", forbiddenSubject)
	}
}

// methodBody is the crude-but-honest way to scope a source assertion to one
// method: from its signature to the first line that is a closing brace in
// column zero. It is exact for gofmt-formatted Go, which every file here is.
func methodBody(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("%s is gone; this assertion no longer describes anything", signature)
	}
	remainder := source[start:]
	end := strings.Index(remainder, "\n}")
	if end < 0 {
		t.Fatalf("%s has no closing brace in column zero", signature)
	}
	return remainder[:end]
}
