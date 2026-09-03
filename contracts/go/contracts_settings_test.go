package contracts

import (
	"strings"
	"testing"
	"time"
)

// The nine keys of batch 1, named here so the registry cannot grow or shrink
// by accident.
//
// This is the same guard as auth-service's TestReservedPermissionsAreDeclaredDeliberately
// and it exists for a sharper reason here: a settings row is operator-visible
// state. A key that drifts in arrives on the admin screen with a value
// somebody can change, and a key that drifts out turns every existing row for
// it into an orphan nothing reads — silently, because the platform keeps
// working off the compiled-in default.
func TestDeclaredSettingsAreDeclaredDeliberately(t *testing.T) {
	expectedKeys := []SettingKey{
		SettingKeyQuotaAIDailyLimitAnonymous,
		SettingKeyQuotaAIDailyLimitAccount,
		SettingKeyAuthTokenAdminAccessTTL,
		SettingKeyAuthTokenAdminRefreshTTL,
		SettingKeyAuthTokenWebAccessTTL,
		SettingKeyAuthTokenWebRefreshTTL,
		SettingKeyAuthTokenInviteTTL,
		SettingKeyAuthLockoutMaximumFailedAttempts,
		SettingKeyAuthLockoutDuration,
	}
	declared := DeclaredSettings()
	if len(declared) != len(expectedKeys) {
		t.Fatalf("the registry declares %d settings and this test names %d. Add the new key here on purpose", len(declared), len(expectedKeys))
	}
	declaredKeys := map[SettingKey]int{}
	for _, definition := range declared {
		declaredKeys[definition.Key]++
	}
	for _, key := range expectedKeys {
		if declaredKeys[key] == 0 {
			t.Errorf("%q is named by this test and missing from the registry", key)
		}
		if declaredKeys[key] > 1 {
			t.Errorf("%q is declared %d times. The second declaration is unreachable through SettingDefinitionFor, so its bounds would never validate anything", key, declaredKeys[key])
		}
	}
}

// Every key matches the scheme, and the scheme's own boundaries are checked
// too — a pattern nothing tests against a rejection is a pattern that could be
// `.*`.
func TestEverySettingKeyFollowsTheScheme(t *testing.T) {
	for _, definition := range DeclaredSettings() {
		if !IsValidSettingKey(definition.Key) {
			t.Errorf("declared key %q does not match the scheme", definition.Key)
		}
		if !strings.Contains(string(definition.Key), ".") {
			t.Errorf("declared key %q has no dot, so it is indistinguishable in shape from an environment variable name", definition.Key)
		}
	}

	refused := []struct {
		description string
		key         SettingKey
	}{
		{description: "empty", key: ""},
		{description: "upper snake, which is what an environment variable looks like", key: "AUTH_LOCKOUT_DURATION"},
		{description: "one upper-case letter", key: "auth.lockout.Duration"},
		{description: "a leading dot", key: ".auth.lockout"},
		{description: "a trailing dot", key: "auth.lockout."},
		{description: "two dots", key: "auth..lockout"},
		{description: "a segment starting with a digit", key: "auth.2fa.window"},
		{description: "a dash", key: "auth.lockout-duration"},
		{description: "a space", key: "auth.lockout duration"},
		{description: "a colon, which would collide with the Redis key separator", key: "auth:lockout"},
	}
	for _, candidate := range refused {
		t.Run(candidate.description, func(t *testing.T) {
			if IsValidSettingKey(candidate.key) {
				t.Fatalf("%q was accepted as a setting key", candidate.key)
			}
		})
	}
}

// Every default is inside its own declared range.
//
// This is the invariant §9.3 calls the one that stops a settings table
// becoming the new hiding place, checked rather than asserted: the default IS
// the behaviour of a fresh environment with an empty table and an empty Redis,
// so a default outside its own bounds means the platform's out-of-the-box
// behaviour is a value the platform itself would refuse an operator. Holding
// defaults as text is what makes this checkable — the default goes through the
// same parser and the same bounds check an operator's value does.
func TestEveryDefaultIsInsideItsOwnDeclaredRange(t *testing.T) {
	for _, definition := range DeclaredSettings() {
		t.Run(string(definition.Key), func(t *testing.T) {
			if err := definition.ValidateValue(definition.DefaultValue); err != nil {
				t.Fatalf("the compiled-in default %q is not a value this setting would accept: %v", definition.DefaultValue, err)
			}
		})
	}
}

// Each declaration bounds its own type and leaves the other type's fields
// alone. A duration setting carrying integer bounds is not a compile error and
// not a runtime error: IntegerValue is simply never called, so the bounds that
// look declared are enforcing nothing.
func TestEveryDeclaredSettingBoundsItsOwnType(t *testing.T) {
	for _, definition := range DeclaredSettings() {
		t.Run(string(definition.Key), func(t *testing.T) {
			if !definition.Type.Valid() {
				t.Fatalf("type %q is not one of the four", definition.Type)
			}
			if strings.TrimSpace(definition.Description) == "" {
				t.Error("no description. The admin screen renders it verbatim and has nothing else to explain the key with")
			}
			switch definition.Type {
			case SettingTypeInteger:
				if definition.MaximumInteger <= definition.MinimumInteger {
					t.Errorf("integer range is [%d, %d], which admits at most one value", definition.MinimumInteger, definition.MaximumInteger)
				}
				if definition.MinimumDuration != 0 || definition.MaximumDuration != 0 {
					t.Error("an integer setting declares duration bounds, which nothing will ever check")
				}
			case SettingTypeDuration:
				if definition.MaximumDuration <= definition.MinimumDuration {
					t.Errorf("duration range is [%s, %s], which admits at most one value", definition.MinimumDuration, definition.MaximumDuration)
				}
				if definition.MinimumDuration <= 0 {
					t.Error("a duration setting admits zero or a negative value, which is not a lifetime")
				}
				if definition.MinimumInteger != 0 || definition.MaximumInteger != 0 {
					t.Error("a duration setting declares integer bounds, which nothing will ever check")
				}
			}
		})
	}
}

// Each audience's access lifetime range ends where its refresh range begins,
// so no pair of values an operator can write leaves an access token outliving
// the refresh token meant to renew it.
//
// This is the test the comment on those constants points at. A per-key bound
// cannot express a cross-key invariant, so the invariant lives in the choice
// of ranges — and the failure mode of that choice is somebody widening one
// maximum without moving the matching minimum, which nothing else would catch.
func TestAccessLifetimeRangesCannotCrossTheirRefreshRanges(t *testing.T) {
	pairs := []struct {
		audience   string
		accessKey  SettingKey
		refreshKey SettingKey
	}{
		{audience: "admin", accessKey: SettingKeyAuthTokenAdminAccessTTL, refreshKey: SettingKeyAuthTokenAdminRefreshTTL},
		{audience: "web", accessKey: SettingKeyAuthTokenWebAccessTTL, refreshKey: SettingKeyAuthTokenWebRefreshTTL},
	}
	for _, pair := range pairs {
		t.Run(pair.audience, func(t *testing.T) {
			access, declared := SettingDefinitionFor(pair.accessKey)
			if !declared {
				t.Fatalf("%q is not declared", pair.accessKey)
			}
			refresh, declared := SettingDefinitionFor(pair.refreshKey)
			if !declared {
				t.Fatalf("%q is not declared", pair.refreshKey)
			}
			if access.MaximumDuration > refresh.MinimumDuration {
				t.Fatalf("the longest access token an operator can set is %s and the shortest refresh token is %s, so the %s session can be configured to expire before it can be renewed",
					FormatSettingDuration(access.MaximumDuration), FormatSettingDuration(refresh.MinimumDuration), pair.audience)
			}
		})
	}
}

// The `d` unit, and the Go syntax it extends rather than replaces.
func TestParseSettingDurationReadsDaysAndGoSyntax(t *testing.T) {
	accepted := []struct {
		raw      string
		expected time.Duration
	}{
		{raw: "7d", expected: 7 * 24 * time.Hour},
		{raw: "1d", expected: 24 * time.Hour},
		{raw: "0d", expected: 0},
		{raw: "90d", expected: 90 * 24 * time.Hour},
		{raw: " 14d ", expected: 14 * 24 * time.Hour},
		{raw: "10m", expected: 10 * time.Minute},
		{raw: "15m", expected: 15 * time.Minute},
		{raw: "12h", expected: 12 * time.Hour},
		{raw: "1h30m", expected: 90 * time.Minute},
		{raw: "2160h", expected: 90 * 24 * time.Hour},
	}
	for _, candidate := range accepted {
		t.Run(candidate.raw, func(t *testing.T) {
			value, err := ParseSettingDuration(candidate.raw)
			if err != nil {
				t.Fatalf("%q was refused: %v", candidate.raw, err)
			}
			if value != candidate.expected {
				t.Fatalf("%q parsed as %s, expected %s", candidate.raw, value, candidate.expected)
			}
		})
	}

	refused := []string{"", "7", "d", "7 d", "1.5d", "7days", "7D", "-", "seven days", "7d7d"}
	for _, raw := range refused {
		t.Run("refused "+raw, func(t *testing.T) {
			if _, err := ParseSettingDuration(raw); err == nil {
				t.Fatalf("%q was accepted as a duration", raw)
			}
		})
	}
}

// A whole number of days formats back to the form it parses from. Anything
// else keeps Go's spelling rather than being rounded into days, because a
// bounds message that says "at most 1d" for a 25-hour maximum is a message
// that lies about which values are allowed.
func TestFormatSettingDurationRoundTripsWholeDays(t *testing.T) {
	roundTripped := []string{"1d", "7d", "14d", "30d", "90d", "365d"}
	for _, raw := range roundTripped {
		t.Run(raw, func(t *testing.T) {
			value, err := ParseSettingDuration(raw)
			if err != nil {
				t.Fatalf("%q was refused: %v", raw, err)
			}
			if formatted := FormatSettingDuration(value); formatted != raw {
				t.Fatalf("%q formatted back as %q", raw, formatted)
			}
		})
	}
	notWholeDays := map[time.Duration]string{
		10 * time.Minute:              "10m0s",
		25 * time.Hour:                "25h0m0s",
		12 * time.Hour:                "12h0m0s",
		time.Duration(0):              "0s",
		24*time.Hour + 30*time.Minute: "24h30m0s",
	}
	for value, expected := range notWholeDays {
		if formatted := FormatSettingDuration(value); formatted != expected {
			t.Errorf("%s formatted as %q, expected %q", value, formatted, expected)
		}
	}
}

// The bounds are enforced at both ends, for both live types. Written against
// two real declared settings rather than a fabricated one, so the ranges
// actually shipped are the ranges checked.
func TestDeclaredBoundsRefuseValuesOutsideThem(t *testing.T) {
	lockoutAttempts, _ := SettingDefinitionFor(SettingKeyAuthLockoutMaximumFailedAttempts)
	adminAccess, _ := SettingDefinitionFor(SettingKeyAuthTokenAdminAccessTTL)

	candidates := []struct {
		description string
		definition  SettingDefinition
		raw         string
		accepted    bool
	}{
		{description: "attempts at the floor", definition: lockoutAttempts, raw: "1", accepted: true},
		{description: "attempts at the ceiling", definition: lockoutAttempts, raw: "100", accepted: true},
		{description: "attempts below the floor locks everyone out including the operator", definition: lockoutAttempts, raw: "0"},
		{description: "attempts negative", definition: lockoutAttempts, raw: "-5"},
		{description: "attempts above the ceiling", definition: lockoutAttempts, raw: "101"},
		{description: "attempts as a duration", definition: lockoutAttempts, raw: "15m"},
		{description: "attempts empty", definition: lockoutAttempts, raw: ""},
		{description: "attempts as a float", definition: lockoutAttempts, raw: "5.5"},
		{description: "admin access at the floor", definition: adminAccess, raw: "1m", accepted: true},
		{description: "admin access at the ceiling", definition: adminAccess, raw: "24h", accepted: true},
		{description: "admin access as a day, which is the ceiling in the other spelling", definition: adminAccess, raw: "1d", accepted: true},
		{description: "admin access above the ceiling", definition: adminAccess, raw: "2d"},
		{description: "admin access at zero", definition: adminAccess, raw: "0s"},
		{description: "admin access negative", definition: adminAccess, raw: "-10m"},
		{description: "admin access as a bare number", definition: adminAccess, raw: "600"},
	}
	for _, candidate := range candidates {
		t.Run(candidate.description, func(t *testing.T) {
			err := candidate.definition.ValidateValue(candidate.raw)
			if candidate.accepted && err != nil {
				t.Fatalf("%q was refused: %v", candidate.raw, err)
			}
			if !candidate.accepted && err == nil {
				t.Fatalf("%q was accepted", candidate.raw)
			}
		})
	}
}

// The two types batch 1 declares nothing for. They are tested against
// definitions written here because there is no declared setting to test them
// against — which is the point: the code paths the tenth setting will be the
// first to use are working now rather than on the day it is added.
func TestBooleanAndStringSettingsValidateTheirOwnVocabularies(t *testing.T) {
	toggle := SettingDefinition{Key: "example.feature.toggle", Type: SettingTypeBoolean, DefaultValue: "false", Description: "example"}
	closedChoice := SettingDefinition{
		Key: "example.provider.name", Type: SettingTypeString, DefaultValue: "mock", Description: "example",
		AllowedValues: []string{"mock", "gemini", "openai"},
	}
	openText := SettingDefinition{Key: "example.banner.text", Type: SettingTypeString, DefaultValue: "hello", Description: "example", MaximumStringLength: 8}

	candidates := []struct {
		description string
		definition  SettingDefinition
		raw         string
		accepted    bool
	}{
		{description: "true", definition: toggle, raw: "true", accepted: true},
		{description: "false", definition: toggle, raw: "false", accepted: true},
		{description: "1 is not a spelling of true here", definition: toggle, raw: "1"},
		{description: "TRUE is not either", definition: toggle, raw: "TRUE"},
		{description: "yes", definition: toggle, raw: "yes"},
		{description: "a listed value", definition: closedChoice, raw: "gemini", accepted: true},
		{description: "an unlisted value", definition: closedChoice, raw: "anthropic"},
		{description: "the right value in the wrong case", definition: closedChoice, raw: "Gemini"},
		{description: "text within the ceiling", definition: openText, raw: "hi there", accepted: true},
		{description: "text over the ceiling", definition: openText, raw: "hi there again"},
		{description: "empty text", definition: openText, raw: "   "},
		// Counted in runes, for the reason MaximumAccountDisplayNameLength is:
		// eight Vietnamese letters are more than eight bytes.
		{description: "eight letters that are more than eight bytes", definition: openText, raw: "đường đi", accepted: true},
	}
	for _, candidate := range candidates {
		t.Run(candidate.description, func(t *testing.T) {
			err := candidate.definition.ValidateValue(candidate.raw)
			if candidate.accepted && err != nil {
				t.Fatalf("%q was refused: %v", candidate.raw, err)
			}
			if !candidate.accepted && err == nil {
				t.Fatalf("%q was accepted", candidate.raw)
			}
		})
	}
}

// A write to a key the registry does not name is refused, and refused with the
// one error the caller can act on differently — an undeclared key is a 404 to
// the operator, while a bad value is a 400.
func TestSettingUpdateDataRefusesWhatItCannotValidate(t *testing.T) {
	const actorAccountID = "33333333-3333-3333-3333-333333333333"

	candidates := []struct {
		description string
		data        SettingUpdateData
		accepted    bool
	}{
		{
			description: "a declared key with a valid value",
			data:        SettingUpdateData{Key: string(SettingKeyAuthLockoutDuration), Value: "30m", ActorAccountID: actorAccountID},
			accepted:    true,
		},
		{
			description: "a declared key with an out-of-range value",
			data:        SettingUpdateData{Key: string(SettingKeyAuthLockoutDuration), Value: "48h", ActorAccountID: actorAccountID},
		},
		{
			description: "a key nothing declares",
			data:        SettingUpdateData{Key: "auth.lockout.forever", Value: "1h", ActorAccountID: actorAccountID},
		},
		{
			description: "an environment variable name",
			data:        SettingUpdateData{Key: "AUTH_LOCKOUT_DURATION", Value: "30m", ActorAccountID: actorAccountID},
		},
		{
			description: "no actor, which would be an unattributable policy change",
			data:        SettingUpdateData{Key: string(SettingKeyAuthLockoutDuration), Value: "30m"},
		},
		{
			description: "an actor that is not a UUID",
			data:        SettingUpdateData{Key: string(SettingKeyAuthLockoutDuration), Value: "30m", ActorAccountID: "the-admin"},
		},
	}
	for _, candidate := range candidates {
		t.Run(candidate.description, func(t *testing.T) {
			err := candidate.data.Validate()
			if candidate.accepted && err != nil {
				t.Fatalf("a valid update was refused: %v", err)
			}
			if !candidate.accepted && err == nil {
				t.Fatal("an invalid update was accepted")
			}
		})
	}

	undeclared := SettingUpdateData{Key: "auth.lockout.forever", Value: "1h", ActorAccountID: actorAccountID}
	if err := undeclared.Validate(); err != ErrSettingNotDeclared {
		t.Fatalf("an undeclared key returned %v rather than ErrSettingNotDeclared, so the caller cannot answer 404 for it", err)
	}
}

// The accessor hands out a copy. Without it, anything that ranges over the
// registry and writes to an element is editing the platform's declared bounds
// for the life of the process.
func TestDeclaredSettingsCannotBeEditedThroughTheAccessor(t *testing.T) {
	firstRead := DeclaredSettings()
	if len(firstRead) == 0 {
		t.Fatal("the registry is empty")
	}
	firstRead[0].MaximumInteger = 0
	firstRead[0].MaximumDuration = 0
	firstRead[0].DefaultValue = "tampered"

	secondRead := DeclaredSettings()
	if secondRead[0].DefaultValue == "tampered" {
		t.Fatal("editing the slice DeclaredSettings returned changed the registry itself")
	}
	definition, declared := SettingDefinitionFor(secondRead[0].Key)
	if !declared {
		t.Fatalf("%q vanished from the registry", secondRead[0].Key)
	}
	if err := definition.ValidateValue(definition.DefaultValue); err != nil {
		t.Fatalf("the registry's bounds were edited through the copy: %v", err)
	}
}
