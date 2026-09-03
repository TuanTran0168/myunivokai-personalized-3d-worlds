package contracts

import (
	"encoding/json"
	"strings"
	"testing"
)

// The precedence between the four reasons is NOT asserted here, and that is
// deliberate: it is a decision about three provider facts that only exist
// inside dna-service, so it is tested where it is implemented
// (services/dna-service/internal/ai/generation_reason_test.go). What this file
// pins is the vocabulary - that the list is complete and distinct, that
// absence stays distinguishable from a value, and that a command published
// before the quota existed still decodes to "no verdict" rather than to a
// verdict of zero.

func TestEveryDeclaredGenerationReasonIsDistinctAndValid(t *testing.T) {
	declaredReasons := DeclaredGenerationReasons()
	if len(declaredReasons) != 4 {
		t.Fatalf("expected the four reasons section 9.1 declares, got %d", len(declaredReasons))
	}
	seenReasons := make(map[GenerationReason]struct{}, len(declaredReasons))
	for _, reason := range declaredReasons {
		if _, alreadySeen := seenReasons[reason]; alreadySeen {
			t.Fatalf("reason %q is declared twice", reason)
		}
		seenReasons[reason] = struct{}{}
		if !reason.Valid() {
			t.Fatalf("declared reason %q does not report itself as valid", reason)
		}
		if strings.TrimSpace(string(reason)) != string(reason) || reason == "" {
			t.Fatalf("reason %q is not a clean identifier", reason)
		}
	}
}

// The reason reaches a database CHECK constraint and a TypeScript union, so a
// value that is not lower_snake_case is a value somebody has to transform on
// the way through - and a transformation is where the four stop being four.
func TestGenerationReasonsAreLowerSnakeCase(t *testing.T) {
	for _, reason := range DeclaredGenerationReasons() {
		for _, character := range string(reason) {
			isLowercaseLetter := character >= 'a' && character <= 'z'
			if !isLowercaseLetter && character != '_' {
				t.Fatalf("reason %q contains %q, which is neither a lowercase letter nor an underscore", reason, character)
			}
		}
	}
}

// Absence is a real state on this field - every job created before the quota
// shipped, and every failed job, carries no reason - so an empty reason must
// never answer "yes, that is one of mine".
func TestAnEmptyGenerationReasonIsNotValid(t *testing.T) {
	var absentReason GenerationReason
	if absentReason.Valid() {
		t.Fatal("an empty reason reports itself as a declared value, so absence and a value are no longer distinguishable")
	}
	if GenerationReason("ai_generated_v2").Valid() {
		t.Fatal("an undeclared reason reports itself as valid")
	}
}

func TestDeclaredGenerationReasonsCannotBeReorderedByACaller(t *testing.T) {
	firstCopy := DeclaredGenerationReasons()
	firstCopy[0] = GenerationReasonAIFailedFallback
	if DeclaredGenerationReasons()[0] != GenerationReasonAIGenerated {
		t.Fatal("a caller mutating the returned slice changed the declaration for everybody else")
	}
}

// The pointer's whole justification. A generate command published before the
// quota existed is still on MYUNIVOKAI_COMMANDS with a seven-day retention, so
// this is a message dna-service really will read - and a zero AIQuotaState
// would tell it "allowed, against a limit of nothing", which is a plausible
// verdict nobody published.
func TestAGenerateCommandFromBeforeTheQuotaDecodesToNoVerdict(t *testing.T) {
	commandFromBeforeTheQuota := `{"jobId":"01JOB","timestamp":"2026-09-01T00:00:00Z",
		"data":{"family":"universe","input":{"nickname":"Mai"}}}`
	var envelope Envelope[GenerateDNAData]
	if err := json.Unmarshal([]byte(commandFromBeforeTheQuota), &envelope); err != nil {
		t.Fatalf("decode a command published before the quota: %v", err)
	}
	if envelope.Data.AIQuota != nil {
		t.Fatalf("expected no quota verdict, got %+v", *envelope.Data.AIQuota)
	}
}

func TestAQuotaVerdictSurvivesTheGenerateCommandRoundTrip(t *testing.T) {
	const enforcedDailyLimit = 5
	command := NewEnvelope("01JOB", GenerateDNAData{
		Family: WorldFamilyUniverse,
		Input:  WorldInput{Nickname: "Mai"},
		AIQuota: &AIQuotaState{
			DailyLimit: enforcedDailyLimit,
			Exhausted:  true,
		},
	})
	encoded, err := json.Marshal(command)
	if err != nil {
		t.Fatalf("encode the command: %v", err)
	}
	var decoded Envelope[GenerateDNAData]
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode the command: %v", err)
	}
	if decoded.Data.AIQuota == nil {
		t.Fatal("the quota verdict did not survive the round trip")
	}
	if decoded.Data.AIQuota.DailyLimit != enforcedDailyLimit {
		t.Fatalf("expected the enforced limit %d back, got %d", enforcedDailyLimit, decoded.Data.AIQuota.DailyLimit)
	}
	if !decoded.Data.AIQuota.Exhausted {
		t.Fatal("the exhausted verdict was lost, so a world would be built with an AI call the gateway refused")
	}
}

// A verdict of "not exhausted" has to encode as a verdict, not as absence.
// Exhausted is a bool, so `omitempty` on the FIELD would erase the difference
// between "the gateway measured this caller and allowed them" and "no gateway
// measured anything" - which is the same mistake the pointer above exists to
// avoid, one level down.
func TestAnAllowedQuotaVerdictIsStillPublishedAsAVerdict(t *testing.T) {
	const enforcedDailyLimit = 25
	encoded, err := json.Marshal(GenerateDNAData{
		Family:  WorldFamilyUniverse,
		Input:   WorldInput{Nickname: "Mai"},
		AIQuota: &AIQuotaState{DailyLimit: enforcedDailyLimit, Exhausted: false},
	})
	if err != nil {
		t.Fatalf("encode the command data: %v", err)
	}
	if !strings.Contains(string(encoded), `"exhausted":false`) {
		t.Fatalf("an allowed verdict did not encode its own falseness: %s", encoded)
	}
	if !strings.Contains(string(encoded), `"dailyLimit":25`) {
		t.Fatalf("an allowed verdict dropped the limit it was measured against: %s", encoded)
	}
}

// A job from before the quota, and every failed job, must serialise with no
// new keys at all - so a client written against the old shape sees exactly
// what it saw.
func TestAJobWithNoReasonAddsNoKeysToItsResponse(t *testing.T) {
	encoded, err := json.Marshal(Job{JobID: "01JOB", Family: WorldFamilyUniverse, Status: JobStatusFailed})
	if err != nil {
		t.Fatalf("encode the job: %v", err)
	}
	for _, addedKey := range []string{"generationReason", "dailyAiGenerationLimit"} {
		if strings.Contains(string(encoded), addedKey) {
			t.Fatalf("a job with no reason still published %q: %s", addedKey, encoded)
		}
	}
}
