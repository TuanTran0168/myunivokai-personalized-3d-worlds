package quota

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/settings"
)

// The limits come from the REAL settings.Reader over a stub cache, not from a
// stubbed limit reader. That is the point of routing them through settings at
// all: an empty mirror has to resolve to the registry's own defaults, and a
// test that stubbed the numbers would pass while the wiring was wrong.

type stubSettingCache struct {
	mirroredValues map[contracts.SettingKey]string
	readError      error
}

func (cache stubSettingCache) GetSetting(_ context.Context, key contracts.SettingKey) (string, error) {
	if cache.readError != nil {
		return "", cache.readError
	}
	value, found := cache.mirroredValues[key]
	if !found {
		return "", edge.ErrCacheMiss
	}
	return value, nil
}

type stubGenerationCounter struct {
	countsByCallerKey map[string]int
	incrementError    error
	callerKeysSeen    []string
}

func newStubGenerationCounter() *stubGenerationCounter {
	return &stubGenerationCounter{countsByCallerKey: make(map[string]int)}
}

func (counter *stubGenerationCounter) IncrementDailyGenerationCount(_ context.Context, callerKey string, at time.Time) (int, error) {
	if counter.incrementError != nil {
		return 0, counter.incrementError
	}
	counter.callerKeysSeen = append(counter.callerKeysSeen, callerKey)
	key := callerKey + "|" + at.UTC().Format("2006-01-02")
	counter.countsByCallerKey[key]++
	return counter.countsByCallerKey[key], nil
}

func newQuotaWithAnEmptyMirror(counter GenerationCounter) DailyAIQuota {
	return NewDailyAIQuota(counter, settings.NewReader(stubSettingCache{}))
}

func stringPointer(value string) *string {
	return &value
}

var quotaTestMoment = time.Date(2026, 9, 3, 14, 30, 0, 0, time.UTC)

// The two numbers decision 8 names, resolved the way the create path resolves
// them: an empty settings table and an empty Redis.
func TestTheTwoAllowancesAreFiveAndTwentyFiveWithNothingConfigured(t *testing.T) {
	quota := newQuotaWithAnEmptyMirror(newStubGenerationCounter())

	anonymousVerdict := quota.Evaluate(context.Background(),
		Caller{AnonymousIdentifier: stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")}, quotaTestMoment)
	if anonymousVerdict.DailyLimit != 5 {
		t.Fatalf("expected an anonymous allowance of 5, got %d", anonymousVerdict.DailyLimit)
	}

	accountVerdict := quota.Evaluate(context.Background(),
		Caller{AccountIdentifier: stringPointer("11111111-1111-1111-1111-111111111111")}, quotaTestMoment)
	if accountVerdict.DailyLimit != 25 {
		t.Fatalf("expected an account allowance of 25, got %d", accountVerdict.DailyLimit)
	}
}

// The boundary, stated as the story states it: the FIFTH create is still an AI
// generation and the SIXTH is not. An off-by-one here is a limit of four
// nobody meant, or of six that never bites on the number an operator typed.
func TestTheFifthCreateIsStillAIAndTheSixthIsNot(t *testing.T) {
	counter := newStubGenerationCounter()
	quota := newQuotaWithAnEmptyMirror(counter)
	anonymousIdentifier := stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")

	for createNumber := 1; createNumber <= 5; createNumber++ {
		verdict := quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, quotaTestMoment)
		if verdict.Exhausted {
			t.Fatalf("create %d of 5 was withheld from the AI tier, against a limit of %d", createNumber, verdict.DailyLimit)
		}
	}
	sixthVerdict := quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, quotaTestMoment)
	if !sixthVerdict.Exhausted {
		t.Fatal("the sixth create of the day was still given the AI tier, so the ceiling does not bind")
	}
	if sixthVerdict.DailyLimit != 5 {
		t.Fatalf("the withheld verdict reported the limit %d rather than the 5 it was measured against", sixthVerdict.DailyLimit)
	}
}

// Nothing to count against means no AI tier. A browser always sends one of the
// two identifiers; a caller that sends neither is the script section 9.2 says
// the quota exists to bound, and it would otherwise have an unlimited
// allowance because a counter with no key never rises.
func TestACallerWithNoIdentityGetsNoAITier(t *testing.T) {
	counter := newStubGenerationCounter()
	quota := newQuotaWithAnEmptyMirror(counter)

	verdict := quota.Evaluate(context.Background(), Caller{}, quotaTestMoment)
	if !verdict.Exhausted {
		t.Fatal("a caller with neither an account nor an anonymous id was given the AI tier, which is an unlimited allowance")
	}
	if verdict.DailyLimit != 5 {
		t.Fatalf("expected the anonymous limit to be reported to a caller with no account, got %d", verdict.DailyLimit)
	}
	if len(counter.callerKeysSeen) != 0 {
		t.Fatalf("a caller with no identity was counted under %q", counter.callerKeysSeen)
	}
}

// The one place this design deliberately fails CLOSED, and the inverse of what
// settings.Reader does on the same outage. A settings miss has a known-good
// default; a spent allowance has none, so a counter that cannot be read must
// not become an unlimited one. It is affordable only because the visitor still
// gets a world.
func TestAnUnreadableCounterWithholdsTheAITierRatherThanIgnoringTheLimit(t *testing.T) {
	counter := newStubGenerationCounter()
	counter.incrementError = errors.New("redis is unreachable")
	quota := newQuotaWithAnEmptyMirror(counter)

	verdict := quota.Evaluate(context.Background(),
		Caller{AnonymousIdentifier: stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")}, quotaTestMoment)
	if !verdict.Exhausted {
		t.Fatal("a Redis outage handed out the AI tier with nothing counting it, which is a ceiling that fails open")
	}
	if verdict.DailyLimit != 5 {
		t.Fatalf("expected the limit still to be reported during an outage, got %d", verdict.DailyLimit)
	}
}

// Exactly one identity field is ever set by the gateway, but the rule has to
// hold anyway: an account is what a signed-in visitor is measured by, and a
// stale anonymous cookie must never reduce their allowance from 25 to 5.
func TestASignedInCallerIsMeasuredByTheirAccount(t *testing.T) {
	counter := newStubGenerationCounter()
	quota := newQuotaWithAnEmptyMirror(counter)

	verdict := quota.Evaluate(context.Background(), Caller{
		AccountIdentifier:   stringPointer("11111111-1111-1111-1111-111111111111"),
		AnonymousIdentifier: stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851"),
	}, quotaTestMoment)
	if verdict.DailyLimit != 25 {
		t.Fatalf("a signed-in caller was measured against the limit %d rather than their account's 25", verdict.DailyLimit)
	}
	if len(counter.callerKeysSeen) != 1 || counter.callerKeysSeen[0] != "account:11111111-1111-1111-1111-111111111111" {
		t.Fatalf("expected the count to be keyed on the account, got %q", counter.callerKeysSeen)
	}
}

// Both identifiers are UUIDs from different databases. The prefix is what
// stops one value being counted as two callers' shared allowance.
func TestAnAccountAndAnAnonymousVisitorNeverShareACounter(t *testing.T) {
	counter := newStubGenerationCounter()
	quota := newQuotaWithAnEmptyMirror(counter)
	const sameIdentifier = "d290f1ee-6c54-4b01-90e6-d701748f0851"

	quota.Evaluate(context.Background(), Caller{AccountIdentifier: stringPointer(sameIdentifier)}, quotaTestMoment)
	quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: stringPointer(sameIdentifier)}, quotaTestMoment)

	if len(counter.callerKeysSeen) != 2 || counter.callerKeysSeen[0] == counter.callerKeysSeen[1] {
		t.Fatalf("an account and an anonymous visitor holding the same UUID shared a counter: %q", counter.callerKeysSeen)
	}
}

// The window resets because the key names its day, not because anything runs.
// That is what section 9 means by "no cleanup job".
func TestANewUTCDayStartsANewAllowance(t *testing.T) {
	counter := newStubGenerationCounter()
	quota := newQuotaWithAnEmptyMirror(counter)
	anonymousIdentifier := stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")

	for createNumber := 1; createNumber <= 6; createNumber++ {
		quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, quotaTestMoment)
	}
	theNextDay := quotaTestMoment.AddDate(0, 0, 1)
	verdict := quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, theNextDay)
	if verdict.Exhausted {
		t.Fatal("the first create of a new UTC day was withheld, so yesterday's count is still being spent")
	}
}

// A limit an operator changed takes effect on the NEXT create, with nothing
// restarted. That is the whole reason the two numbers are settings rather than
// environment variables.
func TestALimitChangedInTheMirrorAppliesToTheNextCreate(t *testing.T) {
	counter := newStubGenerationCounter()
	mirror := stubSettingCache{mirroredValues: map[contracts.SettingKey]string{
		contracts.SettingKeyQuotaAIDailyLimitAnonymous: "1",
	}}
	quota := NewDailyAIQuota(counter, settings.NewReader(mirror))
	anonymousIdentifier := stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")

	firstVerdict := quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, quotaTestMoment)
	if firstVerdict.Exhausted || firstVerdict.DailyLimit != 1 {
		t.Fatalf("expected the first create to be allowed against an operator-set limit of 1, got %+v", firstVerdict)
	}
	secondVerdict := quota.Evaluate(context.Background(), Caller{AnonymousIdentifier: anonymousIdentifier}, quotaTestMoment)
	if !secondVerdict.Exhausted {
		t.Fatal("the second create was still given the AI tier against an operator-set limit of 1")
	}
}

// Zero is a policy, not a mistake: it turns the AI tier off for one audience
// without touching AI_PROVIDER, and its declared range starts at 0 for exactly
// that. The FIRST create must then be withheld.
func TestALimitOfZeroWithholdsTheVeryFirstCreate(t *testing.T) {
	mirror := stubSettingCache{mirroredValues: map[contracts.SettingKey]string{
		contracts.SettingKeyQuotaAIDailyLimitAnonymous: "0",
	}}
	quota := NewDailyAIQuota(newStubGenerationCounter(), settings.NewReader(mirror))

	verdict := quota.Evaluate(context.Background(),
		Caller{AnonymousIdentifier: stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")}, quotaTestMoment)
	if !verdict.Exhausted {
		t.Fatal("a limit of 0 still allowed an AI generation")
	}
	if verdict.DailyLimit != 0 {
		t.Fatalf("expected the reported limit to be 0, got %d", verdict.DailyLimit)
	}
}

// A mirrored value outside its declared bounds is ignored in favour of the
// default on this path too, because bounds are code: a limit that was legal
// when it was written is not made legal by sitting in Redis.
func TestAMirroredLimitOutsideItsBoundsFallsBackToTheDefault(t *testing.T) {
	mirror := stubSettingCache{mirroredValues: map[contracts.SettingKey]string{
		contracts.SettingKeyQuotaAIDailyLimitAnonymous: "999999",
	}}
	quota := NewDailyAIQuota(newStubGenerationCounter(), settings.NewReader(mirror))

	verdict := quota.Evaluate(context.Background(),
		Caller{AnonymousIdentifier: stringPointer("d290f1ee-6c54-4b01-90e6-d701748f0851")}, quotaTestMoment)
	if verdict.DailyLimit != 5 {
		t.Fatalf("expected an out-of-bounds mirrored limit to fall back to the declared default of 5, got %d", verdict.DailyLimit)
	}
}

// The quota's own contribution to the no-cold-start rule. settings.Reader is
// asserted structurally in its own package; this asserts the composition, so
// that a later change giving this package a broker client fails here rather
// than adding 20-60 seconds to every create after a quiet period.
func TestTheQuotaHasNoWayToReachAuthService(t *testing.T) {
	quota := newQuotaWithAnEmptyMirror(newStubGenerationCounter())
	if quota.counter == nil || quota.limits == nil {
		t.Fatal("the quota is missing one of its two dependencies")
	}
	// Two fields, and both are read-only interfaces over Redis or over a
	// compiled-in default. A third would be the thing to look at.
	const expectedDependencyCount = 2
	if dependencyCount := reflect.TypeOf(DailyAIQuota{}).NumField(); dependencyCount != expectedDependencyCount {
		t.Fatalf("DailyAIQuota now has %d dependencies rather than %d. If one of them can reach auth-service, every world creation after a quiet period waits for a cold start on the product's main path",
			dependencyCount, expectedDependencyCount)
	}
}
