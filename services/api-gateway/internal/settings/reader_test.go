package settings

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

// fakeSettingCache is the mirror. It starts EMPTY, which is the state a fresh
// environment is in and the one every assertion here has to hold in.
type fakeSettingCache struct {
	values   map[contracts.SettingKey]string
	readErr  error
	readKeys []contracts.SettingKey
}

func newFakeSettingCache() *fakeSettingCache {
	return &fakeSettingCache{values: map[contracts.SettingKey]string{}}
}

func (cache *fakeSettingCache) GetSetting(_ context.Context, key contracts.SettingKey) (string, error) {
	cache.readKeys = append(cache.readKeys, key)
	if cache.readErr != nil {
		return "", cache.readErr
	}
	value, found := cache.values[key]
	if !found {
		return "", edge.ErrCacheMiss
	}
	return value, nil
}

// A cache miss uses the compiled-in default. This is §9.3's one deliberate
// inversion of RevocationChecker, and the whole reason it exists: auth-service
// sleeps on the free tier, and the gateway enforces the quota on the create
// path, so a NATS fallback here would make a world creation after a quiet
// period wait 20-60 seconds for a cold start to learn a number.
func TestACacheMissUsesTheCompiledInDefault(t *testing.T) {
	cache := newFakeSettingCache()
	reader := NewReader(cache)

	for _, key := range []contracts.SettingKey{
		contracts.SettingKeyQuotaAIDailyLimitAnonymous,
		contracts.SettingKeyQuotaAIDailyLimitAccount,
	} {
		definition, declared := contracts.SettingDefinitionFor(key)
		if !declared {
			t.Fatalf("%q is not declared", key)
		}
		expected, err := definition.IntegerValue(definition.DefaultValue)
		if err != nil {
			t.Fatalf("the declared default for %q is not an integer: %v", key, err)
		}
		if resolved := reader.Integer(context.Background(), key); resolved != expected {
			t.Fatalf("%q resolved to %d on a cache miss, expected its declared default %d", key, resolved, expected)
		}
	}
	if len(cache.readKeys) != 2 {
		t.Fatalf("the reader made %d cache reads for two settings", len(cache.readKeys))
	}
}

// The gateway's own two settings resolve to the numbers §9.3's batch table
// names. Asserted as literals here and nowhere else in this service: these are
// the values a fresh deployment enforces, and "it matches the registry" would
// pass if both were zero.
func TestTheTwoQuotaCeilingsAreFiveAndTwentyFive(t *testing.T) {
	reader := NewReader(newFakeSettingCache())
	if anonymous := reader.Integer(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAnonymous); anonymous != 5 {
		t.Errorf("the anonymous daily AI limit is %d, expected 5", anonymous)
	}
	if account := reader.Integer(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAccount); account != 25 {
		t.Errorf("the account daily AI limit is %d, expected 25", account)
	}
}

// A mirrored value is used when it is there, which is the normal case: this
// mirror is written with no TTL and re-written at every auth-service startup.
func TestAMirroredValueIsUsedWhenItIsValid(t *testing.T) {
	cache := newFakeSettingCache()
	cache.values[contracts.SettingKeyQuotaAIDailyLimitAccount] = "40"
	reader := NewReader(cache)

	if resolved := reader.Integer(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAccount); resolved != 40 {
		t.Fatalf("resolved %d, expected the mirrored 40", resolved)
	}
}

// Bounds are code, on this side of the mirror too. auth-service validates
// before writing, so a mirrored value outside its range means the bounds were
// tightened after the row was written — and the code wins, because the row is
// data.
func TestAMirroredValueOutsideItsBoundsFallsBackToTheDefault(t *testing.T) {
	definition, _ := contracts.SettingDefinitionFor(contracts.SettingKeyQuotaAIDailyLimitAnonymous)
	expected, err := definition.IntegerValue(definition.DefaultValue)
	if err != nil {
		t.Fatalf("the declared default is not an integer: %v", err)
	}

	rejected := []struct {
		description string
		mirrored    string
	}{
		{description: "above the declared ceiling", mirrored: "999999"},
		{description: "negative", mirrored: "-1"},
		{description: "a duration where an integer belongs", mirrored: "10m"},
		{description: "empty, which is what a blanked key looks like", mirrored: ""},
		{description: "a word", mirrored: "unlimited"},
	}
	for _, candidate := range rejected {
		t.Run(candidate.description, func(t *testing.T) {
			cache := newFakeSettingCache()
			cache.values[contracts.SettingKeyQuotaAIDailyLimitAnonymous] = candidate.mirrored
			reader := NewReader(cache)
			if resolved := reader.Integer(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAnonymous); resolved != expected {
				t.Fatalf("a mirrored %q resolved to %d, expected the declared default %d", candidate.mirrored, resolved, expected)
			}
		})
	}
}

// A Redis outage is not a failed world creation. The reader returns a value in
// every case, so there is nothing for a caller to decide between failing the
// request and ignoring the error — which is the whole reason these methods
// return no error.
func TestACacheErrorFallsBackToTheDefaultRatherThanFailing(t *testing.T) {
	cache := newFakeSettingCache()
	cache.readErr = errors.New("redis is unreachable")
	reader := NewReader(cache)

	definition, _ := contracts.SettingDefinitionFor(contracts.SettingKeyQuotaAIDailyLimitAccount)
	expected, err := definition.IntegerValue(definition.DefaultValue)
	if err != nil {
		t.Fatalf("the declared default is not an integer: %v", err)
	}
	if resolved := reader.Integer(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAccount); resolved != expected {
		t.Fatalf("resolved %d during a Redis outage, expected the declared default %d", resolved, expected)
	}
}

// The structural half of "never a NATS request", and the reason it is written
// as a reflection test rather than as a comment.
//
// Every other assertion in this file shows that the reader DOES NOT ask
// auth-service today. None of them would fail if somebody gave Reader a
// requester field and used it only on a miss — which is exactly the change a
// later reader makes while "fixing" this into consistency with
// RevocationChecker, because that type's shape is the one this repository uses
// everywhere else.
//
// So this asserts the shape: one field, and it is the cache. A reader with
// nothing to ask with cannot reintroduce a cold start on the create path.
func TestTheSettingsReaderHasNoWayToAskAuthService(t *testing.T) {
	readerType := reflect.TypeOf(Reader{})
	if readerType.NumField() != 1 {
		names := make([]string, 0, readerType.NumField())
		for index := 0; index < readerType.NumField(); index++ {
			names = append(names, readerType.Field(index).Name)
		}
		t.Fatalf("Reader has %d fields (%s). It is allowed exactly one, the settings cache: a second dependency is how a NATS request gets back onto the create path, which §9.3 forbids by name",
			readerType.NumField(), strings.Join(names, ", "))
	}
	cacheField := readerType.Field(0)
	if cacheField.Type != reflect.TypeOf((*SettingCache)(nil)).Elem() {
		t.Fatalf("Reader's one field is a %s, expected the SettingCache interface. Anything else can talk to something other than Redis", cacheField.Type)
	}
	// And SettingCache itself admits exactly one operation, so satisfying it
	// cannot smuggle in a requester.
	cacheType := reflect.TypeOf((*SettingCache)(nil)).Elem()
	if cacheType.NumMethod() != 1 || cacheType.Method(0).Name != "GetSetting" {
		t.Fatalf("SettingCache declares %d methods, expected only GetSetting", cacheType.NumMethod())
	}
}

// The Duration resolver has no declared setting in this service yet, so it is
// tested against one from the registry that auth-service owns. It exists
// because the reader is the mechanism rather than the two quota rows — batch 2
// moves the gateway's three cache TTLs here, and a resolver whose duration
// branch has never run is how the first of those ships silently broken.
func TestTheDurationResolverWorksBeforeTheGatewayDeclaresOne(t *testing.T) {
	cache := newFakeSettingCache()
	reader := NewReader(cache)

	definition, _ := contracts.SettingDefinitionFor(contracts.SettingKeyAuthLockoutDuration)
	expected, err := definition.DurationValue(definition.DefaultValue)
	if err != nil {
		t.Fatalf("the declared default is not a duration: %v", err)
	}
	if resolved := reader.Duration(context.Background(), contracts.SettingKeyAuthLockoutDuration); resolved != expected {
		t.Fatalf("resolved %s on a miss, expected the declared default %s", resolved, expected)
	}

	cache.values[contracts.SettingKeyAuthLockoutDuration] = "30m"
	if resolved := reader.Duration(context.Background(), contracts.SettingKeyAuthLockoutDuration); resolved != 30*time.Minute {
		t.Fatalf("resolved %s, expected the mirrored 30m", resolved)
	}
}

// A key the registry does not declare resolves to zero and logs, rather than
// panicking or inventing a limit. Unreachable through any call site — every
// caller passes a registry constant — and handled because the alternative is a
// nil map read on a code path that runs on every world creation.
func TestAnUndeclaredKeyResolvesToZeroWithoutTouchingTheCache(t *testing.T) {
	cache := newFakeSettingCache()
	reader := NewReader(cache)

	if resolved := reader.Integer(context.Background(), contracts.SettingKey("quota.ai.daily_limit.invented")); resolved != 0 {
		t.Fatalf("resolved %d for an undeclared key, expected 0", resolved)
	}
	if len(cache.readKeys) != 0 {
		t.Fatalf("the cache was read %d times for a key with no declaration to validate against", len(cache.readKeys))
	}
}
