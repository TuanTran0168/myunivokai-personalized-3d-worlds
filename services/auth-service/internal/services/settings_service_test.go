package services

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

const testActorAccountID = "44444444-4444-4444-4444-444444444444"

func settingSummaryFor(t *testing.T, settings []contracts.SettingSummary, key contracts.SettingKey) contracts.SettingSummary {
	t.Helper()
	for _, summary := range settings {
		if summary.Key == string(key) {
			return summary
		}
	}
	t.Fatalf("%q is missing from the settings list", key)
	return contracts.SettingSummary{}
}

// §9.3's central invariant, and the scenario the story names: "An empty
// settings table is a working platform."
//
// A settings mechanism whose first requirement is a seeded table has replaced
// an environment variable with a required piece of database content — strictly
// worse than what it replaced, because nothing declares it. So this asserts
// both halves: the screen reads correctly with no rows, and the platform
// BEHAVES correctly with no rows, which is the half a list assertion alone
// would miss.
func TestAnEmptySettingsTableIsAWorkingPlatform(t *testing.T) {
	authService, store, _ := newTestAuthService(t)

	rows, err := store.ListSystemSettings(context.Background())
	if err != nil {
		t.Fatalf("list rows: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("the test store starts with %d settings rows, so this test would not be testing an empty table", len(rows))
	}

	listed, err := authService.ListSettings(context.Background())
	if err != nil {
		t.Fatalf("list settings: %v", err)
	}
	if len(listed.Settings) != len(contracts.DeclaredSettings()) {
		t.Fatalf("listed %d settings from an empty table, expected the %d declared ones", len(listed.Settings), len(contracts.DeclaredSettings()))
	}
	for _, summary := range listed.Settings {
		if summary.IsOverridden {
			t.Errorf("%q reports an override with no rows in the table", summary.Key)
		}
		if summary.Value != summary.DefaultValue {
			t.Errorf("%q reads as %q with no row, expected its default %q", summary.Key, summary.Value, summary.DefaultValue)
		}
		if strings.TrimSpace(summary.Value) == "" {
			t.Errorf("%q has no effective value at all, so the screen would render a blank field", summary.Key)
		}
	}

	// And the behaving half. A sign-up with no settings rows must produce a
	// session with the declared lifetimes rather than a zero-length one.
	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "empty-table@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up with an empty settings table: %v", err)
	}
	assertLifetimeWithin(t, "access", session.AccessExpiresAt, declaredSettingDuration(t, contracts.SettingKeyAuthTokenWebAccessTTL))
	assertLifetimeWithin(t, "refresh", session.RefreshExpiresAt, declaredSettingDuration(t, contracts.SettingKeyAuthTokenWebRefreshTTL))
}

// The story's headline: "it takes effect on the next request without any
// service restarting".
//
// This is the assertion the whole restructuring of TokenIssuer was for. The
// lifetime used to be captured when that struct was built, so a changed value
// could not have been observed by anything short of a redeploy.
func TestASettingTakesEffectOnTheNextRequestWithoutARestart(t *testing.T) {
	authService, _, _ := newTestAuthService(t)

	const shortenedWebAccessLifetime = "10m"
	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyAuthTokenWebAccessTTL), Value: shortenedWebAccessLifetime,
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.5",
	}); err != nil {
		t.Fatalf("update setting: %v", err)
	}

	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "next-request@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	expected, err := contracts.ParseSettingDuration(shortenedWebAccessLifetime)
	if err != nil {
		t.Fatalf("parse the value under test: %v", err)
	}
	assertLifetimeWithin(t, "access", session.AccessExpiresAt, expected)

	// The same service, without being rebuilt, goes back to the default when
	// the row is replaced with the default value — the change is live in both
	// directions, which a one-way assertion would not show.
	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyAuthTokenWebAccessTTL), Value: "7d",
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.5",
	}); err != nil {
		t.Fatalf("update setting back: %v", err)
	}
	restored, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "next-request-again@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up again: %v", err)
	}
	assertLifetimeWithin(t, "access", restored.AccessExpiresAt, 7*24*time.Hour)
}

// A write leaves three traces, and all three matter separately: the row is
// what auth-service reads, the Redis mirror is what the GATEWAY reads, and the
// audit row is the only history of the change that exists anywhere.
func TestUpdateSettingWritesTheRowTheMirrorAndTheAuditTransition(t *testing.T) {
	authService, store, cache := newTestAuthService(t)

	summary, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyQuotaAIDailyLimitAnonymous), Value: "9",
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.9",
	})
	if err != nil {
		t.Fatalf("update setting: %v", err)
	}
	if summary.Value != "9" || !summary.IsOverridden {
		t.Fatalf("summary = %+v, expected the written value and an override", summary)
	}
	if summary.UpdatedByAccountID != testActorAccountID {
		t.Fatalf("summary records %q as the actor, expected %q", summary.UpdatedByAccountID, testActorAccountID)
	}

	row, err := store.GetSystemSetting(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAnonymous)
	if err != nil {
		t.Fatalf("read the row back: %v", err)
	}
	if row.Value != "9" {
		t.Fatalf("stored value = %q, expected 9", row.Value)
	}

	mirrored, found := cache.mirroredSetting(contracts.SettingKeyQuotaAIDailyLimitAnonymous)
	if !found {
		t.Fatal("nothing was mirrored into Redis, so the gateway would go on enforcing the old quota until the next boot")
	}
	if mirrored != "9" {
		t.Fatalf("mirrored value = %q, expected 9", mirrored)
	}

	events, _, _, err := store.ListAuditEvents(context.Background(), "", 50, nil, nil, "")
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	transition := ""
	for _, event := range events {
		if event.Action == auditActionSettingUpdate {
			transition = event.Target
		}
	}
	// `default` rather than an empty side: there was no row, so what this
	// replaced is the compiled-in default, and "5 -> 9" would claim a row
	// existed.
	expectedTransition := string(contracts.SettingKeyQuotaAIDailyLimitAnonymous) + ": default -> 9"
	if transition != expectedTransition {
		t.Fatalf("audit target = %q, expected %q", transition, expectedTransition)
	}

	// The second write names the value it actually replaced.
	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyQuotaAIDailyLimitAnonymous), Value: "11",
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.9",
	}); err != nil {
		t.Fatalf("second update: %v", err)
	}
	events, _, _, err = store.ListAuditEvents(context.Background(), "", 50, nil, nil, "")
	if err != nil {
		t.Fatalf("list audit events again: %v", err)
	}
	secondTransition := ""
	for _, event := range events {
		if event.Action == auditActionSettingUpdate && strings.HasSuffix(event.Target, "-> 11") {
			secondTransition = event.Target
		}
	}
	expectedSecond := string(contracts.SettingKeyQuotaAIDailyLimitAnonymous) + ": 9 -> 11"
	if secondTransition != expectedSecond {
		t.Fatalf("second audit target = %q, expected %q", secondTransition, expectedSecond)
	}
}

// Bounds are code. A value outside its declared range is refused, and an
// undeclared key is refused with the one error a caller can act on differently
// — 404 for a key that names nothing, 400 for a value the key will not take.
func TestUpdateSettingRefusesWhatTheRegistryDoesNotAllow(t *testing.T) {
	authService, store, _ := newTestAuthService(t)

	refusals := []struct {
		description string
		key         string
		value       string
		expected    error
	}{
		{
			description: "a lockout window longer than the declared ceiling",
			key:         string(contracts.SettingKeyAuthLockoutDuration), value: "48h", expected: ErrSettingValueInvalid,
		},
		{
			description: "a lockout threshold of zero, which would lock everyone out including the operator",
			key:         string(contracts.SettingKeyAuthLockoutMaximumFailedAttempts), value: "0", expected: ErrSettingValueInvalid,
		},
		{
			description: "a quota above the spend ceiling",
			key:         string(contracts.SettingKeyQuotaAIDailyLimitAccount), value: "100000", expected: ErrSettingValueInvalid,
		},
		{
			description: "a duration where an integer belongs",
			key:         string(contracts.SettingKeyQuotaAIDailyLimitAccount), value: "25m", expected: ErrSettingValueInvalid,
		},
		{
			description: "a key nothing declares",
			key:         "auth.lockout.forever", value: "1h", expected: contracts.ErrSettingNotDeclared,
		},
		{
			description: "an environment variable name",
			key:         "AUTH_LOCKOUT_DURATION", value: "30m", expected: contracts.ErrSettingNotDeclared,
		},
	}
	for _, refusal := range refusals {
		t.Run(refusal.description, func(t *testing.T) {
			_, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
				Key: refusal.key, Value: refusal.value, ActorAccountID: testActorAccountID,
			})
			if !errors.Is(err, refusal.expected) {
				t.Fatalf("err = %v, want %v", err, refusal.expected)
			}
		})
	}

	rows, err := store.ListSystemSettings(context.Background())
	if err != nil {
		t.Fatalf("list rows: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("%d rows were written by refused updates", len(rows))
	}
}

// A failed mirror write is reported rather than swallowed.
//
// The row is committed by then, and that is deliberate: Postgres is
// authoritative and this service reads it directly, so the change IS live
// here. What is not live is the gateway, which reads the mirror — so answering
// the operator with success would tell them a new quota is being enforced when
// the old one still is. The retry is safe: the same row and the same mirror
// written twice change nothing.
func TestUpdateSettingReportsAFailedMirrorRatherThanClaimingSuccess(t *testing.T) {
	authService, store, cache := newTestAuthService(t)
	cache.settingWriteError = errors.New("redis is unreachable")

	_, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyQuotaAIDailyLimitAccount), Value: "40",
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.4",
	})
	if err == nil {
		t.Fatal("a failed mirror write was reported as a successful settings change")
	}

	row, readErr := store.GetSystemSetting(context.Background(), contracts.SettingKeyQuotaAIDailyLimitAccount)
	if readErr != nil {
		t.Fatalf("the row should still be committed: %v", readErr)
	}
	if row.Value != "40" {
		t.Fatalf("stored value = %q, expected the write to have been committed as 40", row.Value)
	}

	// The audit row is written before the mirror, so the transition that
	// actually happened is recorded even though the caller saw an error.
	events, _, _, listErr := store.ListAuditEvents(context.Background(), "", 50, nil, nil, "")
	if listErr != nil {
		t.Fatalf("list audit events: %v", listErr)
	}
	recorded := false
	for _, event := range events {
		if event.Action == auditActionSettingUpdate {
			recorded = true
		}
	}
	if !recorded {
		t.Fatal("no audit row for a change that was committed to the database")
	}

	// And the retry succeeds once Redis is back, without a second row.
	cache.settingWriteError = nil
	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyQuotaAIDailyLimitAccount), Value: "40",
		ActorAccountID: testActorAccountID, SourceAddress: "203.0.113.4",
	}); err != nil {
		t.Fatalf("the retry failed: %v", err)
	}
	if mirrored, found := cache.mirroredSetting(contracts.SettingKeyQuotaAIDailyLimitAccount); !found || mirrored != "40" {
		t.Fatalf("mirrored = %q found = %v, expected 40 after the retry", mirrored, found)
	}
}

// A row that no longer satisfies its declaration is ignored in favour of the
// default — and still shown on the screen.
//
// The two halves pull in opposite directions on purpose. Behaviour must not
// trust it, because bounds are code and a value is not made legal by being in
// a database; the screen must show it, because an operator looking at a
// platform that disagrees with its own database needs to see why. Hiding the
// row would leave them reading a default with no explanation.
//
// The row is written through the store, which does not validate, because that
// is exactly how such a row appears in production: bounds tightened in a later
// release, against a value that was legal when it was written.
func TestAStoredValueOutsideItsBoundsIsIgnoredButStillShown(t *testing.T) {
	authService, store, _ := newTestAuthService(t)

	if _, err := store.UpsertSystemSetting(context.Background(),
		contracts.SettingKeyAuthLockoutMaximumFailedAttempts, "0", testActorAccountID); err != nil {
		t.Fatalf("write the out-of-bounds row: %v", err)
	}

	// Behaviour uses the default, which testConfig sets to 3 — so a single
	// failed sign-in must NOT lock the account.
	account := createTestAccount(t, authService, store, "bounds@example.com", "a-strong-password-1")
	if _, err := authService.Login(context.Background(), contracts.LoginData{
		Email: account.Email, Password: "the-wrong-password",
	}, "203.0.113.2"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("first failed sign-in: err = %v, want ErrInvalidCredentials", err)
	}
	if _, err := authService.Login(context.Background(), contracts.LoginData{
		Email: account.Email, Password: "a-strong-password-1",
	}, "203.0.113.2"); err != nil {
		t.Fatalf("the account was locked by a threshold of 0 that should have been ignored: %v", err)
	}

	// The screen shows the stored value and the default beside it.
	listed, err := authService.ListSettings(context.Background())
	if err != nil {
		t.Fatalf("list settings: %v", err)
	}
	summary := settingSummaryFor(t, listed.Settings, contracts.SettingKeyAuthLockoutMaximumFailedAttempts)
	if summary.Value != "0" {
		t.Fatalf("the screen shows %q, expected the stored 0 so an operator can correct it", summary.Value)
	}
	if summary.DefaultValue == "0" {
		t.Fatal("the default reads as 0 too, so the screen gives no way to tell the stored value from the one in force")
	}
}

// An orphan row — one whose key has left the registry — is listed as unknown
// and never deleted.
//
// §9.3 makes this the deliberate opposite of SyncPermissions, which ends in
// `DELETE FROM permissions WHERE NOT (codename = ANY($1))` and so removes a
// codename from production on the next boot. A settings row holds a number
// somebody chose; deleting it because the code stopped naming it would discard
// an operator's decision silently.
func TestAnOrphanRowIsListedAsUnknownAndNeverDeleted(t *testing.T) {
	authService, store, _ := newTestAuthService(t)

	const orphanKey = contracts.SettingKey("quota.ai.daily_limit.retired_tier")
	if _, declared := contracts.SettingDefinitionFor(orphanKey); declared {
		t.Fatalf("%q is declared, so this test is not testing an orphan", orphanKey)
	}
	if _, err := store.UpsertSystemSetting(context.Background(), orphanKey, "3", testActorAccountID); err != nil {
		t.Fatalf("write the orphan row: %v", err)
	}

	listed, err := authService.ListSettings(context.Background())
	if err != nil {
		t.Fatalf("list settings: %v", err)
	}
	if len(listed.Settings) != len(contracts.DeclaredSettings())+1 {
		t.Fatalf("listed %d settings, expected the %d declared ones plus the orphan", len(listed.Settings), len(contracts.DeclaredSettings()))
	}
	orphan := settingSummaryFor(t, listed.Settings, orphanKey)
	if orphan.IsDeclared {
		t.Fatal("the orphan reports itself as declared, so the screen would offer to edit it against bounds that no longer exist")
	}
	if orphan.Value != "3" {
		t.Fatalf("orphan value = %q, expected the stored 3", orphan.Value)
	}
	if orphan.Type != "" || orphan.DefaultValue != "" || orphan.Minimum != "" {
		t.Fatalf("the orphan carries a type, default or bound (%+v) taken from a declaration that no longer exists", orphan)
	}

	// Still there. Nothing in a read path removes it.
	if _, err := store.GetSystemSetting(context.Background(), orphanKey); err != nil {
		t.Fatalf("the orphan row was removed by listing the settings: %v", err)
	}
}

// The startup mirror covers every declared setting, which is what lets the
// gateway treat a cache miss as "use the default" instead of as a reason to
// wake this service.
//
// It mirrors the EFFECTIVE value, so a hit answers the gateway's question
// completely and the compiled-in default stays a genuine last resort rather
// than the normal answer for eight of the nine keys.
func TestMirrorSettingsToCacheCoversEveryDeclaredSetting(t *testing.T) {
	authService, store, cache := newTestAuthService(t)

	if _, err := store.UpsertSystemSetting(context.Background(),
		contracts.SettingKeyQuotaAIDailyLimitAnonymous, "2", testActorAccountID); err != nil {
		t.Fatalf("write a row: %v", err)
	}
	if _, err := store.UpsertSystemSetting(context.Background(),
		contracts.SettingKey("quota.ai.daily_limit.retired_tier"), "3", testActorAccountID); err != nil {
		t.Fatalf("write an orphan row: %v", err)
	}

	if err := authService.MirrorSettingsToCache(context.Background()); err != nil {
		t.Fatalf("mirror settings: %v", err)
	}

	for _, definition := range contracts.DeclaredSettings() {
		mirrored, found := cache.mirroredSetting(definition.Key)
		if !found {
			t.Errorf("%q was not mirrored, so the gateway falls back to its compiled-in default for it", definition.Key)
			continue
		}
		if err := definition.ValidateValue(mirrored); err != nil {
			t.Errorf("%q was mirrored as %q, which the gateway could not parse: %v", definition.Key, mirrored, err)
		}
	}
	if mirrored, _ := cache.mirroredSetting(contracts.SettingKeyQuotaAIDailyLimitAnonymous); mirrored != "2" {
		t.Fatalf("the overridden setting was mirrored as %q, expected the stored 2 rather than its default", mirrored)
	}
	if _, found := cache.mirroredSetting(contracts.SettingKey("quota.ai.daily_limit.retired_tier")); found {
		t.Fatal("an orphan row was mirrored into Redis, where nothing can parse it")
	}
}

// Both ends of a session come from the audience's OWN settings.
//
// This is the behaviour that moved out of TokenIssuer when the lifetimes
// became settings, and the failure it guards is the one the deleted test named:
// the ADMIN lifetime being applied to a web session. It is asserted on the
// response rather than on the constants, because no assertion on the constants
// would catch that.
func TestSessionLifetimesComeFromTheAudiencesOwnSettings(t *testing.T) {
	authService, store, _ := newTestAuthService(t)

	staff := createTestAccount(t, authService, store, "staff-lifetimes@example.com", "a-strong-password-1")
	staffSession, err := authService.Login(context.Background(), contracts.LoginData{
		Email: staff.Email, Password: "a-strong-password-1",
	}, "203.0.113.3")
	if err != nil {
		t.Fatalf("staff login: %v", err)
	}
	// The admin pair's default is still an environment variable, which
	// testConfig sets — that is §9.3's "the five keep their env var as their
	// default", asserted rather than described.
	assertLifetimeWithin(t, "admin access", staffSession.AccessExpiresAt, testConfig().AccessTokenTTL)
	assertLifetimeWithin(t, "admin refresh", staffSession.RefreshExpiresAt, testConfig().RefreshTokenTTL)

	webSession, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "web-lifetimes@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("web sign up: %v", err)
	}
	assertLifetimeWithin(t, "web access", webSession.AccessExpiresAt, declaredSettingDuration(t, contracts.SettingKeyAuthTokenWebAccessTTL))
	assertLifetimeWithin(t, "web refresh", webSession.RefreshExpiresAt, declaredSettingDuration(t, contracts.SettingKeyAuthTokenWebRefreshTTL))

	// And changing one audience's setting leaves the other alone, which is the
	// property one shared TokenIssuer field could not have had.
	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyAuthTokenWebAccessTTL), Value: "30m",
		ActorAccountID: testActorAccountID,
	}); err != nil {
		t.Fatalf("shorten the web access lifetime: %v", err)
	}
	staffAgain, err := authService.Login(context.Background(), contracts.LoginData{
		Email: staff.Email, Password: "a-strong-password-1",
	}, "203.0.113.3")
	if err != nil {
		t.Fatalf("staff login again: %v", err)
	}
	assertLifetimeWithin(t, "admin access after a web change", staffAgain.AccessExpiresAt, testConfig().AccessTokenTTL)
}

// The lockout pair is read on each failed attempt, so tightening the threshold
// applies to the next sign-in rather than to the next deploy.
func TestTheLockoutThresholdIsReadOnEachFailedAttempt(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "lockout@example.com", "a-strong-password-1")

	if _, err := authService.UpdateSetting(context.Background(), contracts.SettingUpdateData{
		Key: string(contracts.SettingKeyAuthLockoutMaximumFailedAttempts), Value: "1",
		ActorAccountID: testActorAccountID,
	}); err != nil {
		t.Fatalf("tighten the lockout threshold: %v", err)
	}

	if _, err := authService.Login(context.Background(), contracts.LoginData{
		Email: account.Email, Password: "the-wrong-password",
	}, "203.0.113.6"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("failed sign-in: err = %v, want ErrInvalidCredentials", err)
	}
	// One failure was enough, because the threshold was read at the moment of
	// use. With testConfig's default of three it would have taken three.
	if _, err := authService.Login(context.Background(), contracts.LoginData{
		Email: account.Email, Password: "a-strong-password-1",
	}, "203.0.113.6"); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked after one failure at a threshold of 1", err)
	}
}

// The five migrated settings' defaults are the environment variables they
// replace, and this is the ratchet that keeps the two sides from drifting.
//
// §9.3 keeps those variables as the DEFAULT rather than deleting them, so each
// of the five now has its number written in two places: auth-service's config
// loader and the contracts registry. Two copies of a value that must agree is
// exactly the shape this repository fails on, and the failure would be silent
// — a fresh environment would simply behave differently from the number an
// operator reads on the settings screen. So the agreement is asserted, and
// changing one side alone fails here.
//
// config.Load is called with MYUNIVOKAI_ENV_FILE pointing at nothing, so no
// .env file can supply a value and every variable falls to its compiled-in
// default — which is the pairing under test.
func TestMigratedSettingDefaultsAgreeWithTheEnvironmentTheyReplace(t *testing.T) {
	t.Setenv("MYUNIVOKAI_ENV_FILE", "a-file-that-does-not-exist.env")
	t.Setenv("DATABASE_URL", "postgres://settings-test/myunivokai_auth")
	t.Setenv("REDIS_URL", "redis://settings-test:6379")
	t.Setenv("AUTH_ACCESS_PRIVATE_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	for _, unset := range []string{
		"AUTH_ACCESS_TOKEN_TTL", "AUTH_REFRESH_TOKEN_TTL", "AUTH_INVITE_TOKEN_TTL",
		"AUTH_MAX_FAILED_ATTEMPTS", "AUTH_LOCKOUT_DURATION",
	} {
		t.Setenv(unset, "")
	}

	loadedConfig, err := config.Load()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	serviceUnderTest := &AuthService{cfg: loadedConfig}

	pairs := []struct {
		key                 contracts.SettingKey
		environmentVariable string
		environmentDefault  string
	}{
		{key: contracts.SettingKeyAuthTokenAdminAccessTTL, environmentVariable: "AUTH_ACCESS_TOKEN_TTL",
			environmentDefault: contracts.FormatSettingDuration(loadedConfig.AccessTokenTTL)},
		{key: contracts.SettingKeyAuthTokenAdminRefreshTTL, environmentVariable: "AUTH_REFRESH_TOKEN_TTL",
			environmentDefault: contracts.FormatSettingDuration(loadedConfig.RefreshTokenTTL)},
		{key: contracts.SettingKeyAuthTokenInviteTTL, environmentVariable: "AUTH_INVITE_TOKEN_TTL",
			environmentDefault: contracts.FormatSettingDuration(loadedConfig.InviteTokenTTL)},
		{key: contracts.SettingKeyAuthLockoutDuration, environmentVariable: "AUTH_LOCKOUT_DURATION",
			environmentDefault: contracts.FormatSettingDuration(loadedConfig.LockoutDuration)},
	}
	for _, pair := range pairs {
		t.Run(string(pair.key), func(t *testing.T) {
			definition, declared := contracts.SettingDefinitionFor(pair.key)
			if !declared {
				t.Fatalf("%q is not declared", pair.key)
			}
			// The registry's own default, and the environment's, must be the
			// same duration. Compared as durations rather than as strings,
			// because `14d` and `336h` are the same value written two ways and
			// only the second is what FormatSettingDuration produces for some
			// of them.
			registryDefault, err := contracts.ParseSettingDuration(definition.DefaultValue)
			if err != nil {
				t.Fatalf("the registry default %q is not a duration: %v", definition.DefaultValue, err)
			}
			environmentDefault, err := contracts.ParseSettingDuration(pair.environmentDefault)
			if err != nil {
				t.Fatalf("the environment default %q is not a duration: %v", pair.environmentDefault, err)
			}
			if registryDefault != environmentDefault {
				t.Fatalf("%q defaults to %s and %s defaults to %s. §9.3 keeps the environment variable as this setting's default, so the two must be one number",
					pair.key, registryDefault, pair.environmentVariable, environmentDefault)
			}
			// And what the service actually resolves with no row is the
			// environment's value, which is the behaviour the pairing is for.
			if resolved := serviceUnderTest.settingDefaultValue(definition); resolved != pair.environmentDefault {
				t.Fatalf("with no row, %q resolves to %q rather than to the environment's %q", pair.key, resolved, pair.environmentDefault)
			}
		})
	}

	// The lockout threshold is the fifth, and an integer rather than a
	// duration.
	attempts, declared := contracts.SettingDefinitionFor(contracts.SettingKeyAuthLockoutMaximumFailedAttempts)
	if !declared {
		t.Fatal("the lockout threshold is not declared")
	}
	registryAttempts, err := attempts.IntegerValue(attempts.DefaultValue)
	if err != nil {
		t.Fatalf("the registry default for the lockout threshold is not an integer: %v", err)
	}
	if registryAttempts != loadedConfig.MaximumFailedAttempts {
		t.Fatalf("auth.lockout.max_failed_attempts defaults to %d and AUTH_MAX_FAILED_ATTEMPTS defaults to %d",
			registryAttempts, loadedConfig.MaximumFailedAttempts)
	}

	// The four born-as-settings have NO environment variable, and must not
	// acquire one: §9.3 gives them a Go constant precisely so `.env` stops
	// absorbing product policy. settingDefaultValue's switch is where one
	// would appear, so this asserts they fall through it.
	bornAsSettings := []contracts.SettingKey{
		contracts.SettingKeyQuotaAIDailyLimitAnonymous,
		contracts.SettingKeyQuotaAIDailyLimitAccount,
		contracts.SettingKeyAuthTokenWebAccessTTL,
		contracts.SettingKeyAuthTokenWebRefreshTTL,
	}
	for _, key := range bornAsSettings {
		definition, declared := contracts.SettingDefinitionFor(key)
		if !declared {
			t.Fatalf("%q is not declared", key)
		}
		if resolved := serviceUnderTest.settingDefaultValue(definition); resolved != definition.DefaultValue {
			t.Errorf("%q resolves its default to %q rather than to the registry's %q, so something gave a born-as-a-setting value an environment variable",
				key, resolved, definition.DefaultValue)
		}
	}
}

// The one behaviour that would be easy to lose: this service reads its own
// settings from POSTGRES, never from the Redis mirror it writes.
//
// Going through its own mirror would make auth-service's behaviour depend on a
// cache it populated — a flushed Redis would silently revert this service's
// policy to the defaults while the rows still said otherwise. The gateway
// reads the mirror because it must not wake this service to ask; this service
// has no such constraint.
func TestAuthServiceReadsItsOwnSettingsFromPostgresNotFromTheMirror(t *testing.T) {
	authService, store, cache := newTestAuthService(t)

	if _, err := store.UpsertSystemSetting(context.Background(),
		contracts.SettingKeyAuthTokenWebAccessTTL, "20m", testActorAccountID); err != nil {
		t.Fatalf("write the row: %v", err)
	}
	if _, mirrored := cache.mirroredSetting(contracts.SettingKeyAuthTokenWebAccessTTL); mirrored {
		t.Fatal("writing a row through the store mirrored it too, so this test cannot tell the two sources apart")
	}

	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "postgres-read@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}
	assertLifetimeWithin(t, "access", session.AccessExpiresAt, 20*time.Minute)
}

// A repositories.ErrNotFound from the settings store is the NORMAL case and
// must never surface as a failure. Asserted directly, because every other test
// here reaches it through a service method that would hide the difference
// between "no row" and "the read failed".
func TestAnAbsentSettingRowIsNotAnError(t *testing.T) {
	_, store, _ := newTestAuthService(t)
	_, err := store.GetSystemSetting(context.Background(), contracts.SettingKeyAuthLockoutDuration)
	if !errors.Is(err, repositories.ErrNotFound) {
		t.Fatalf("err = %v, want repositories.ErrNotFound for a key with no row", err)
	}
}
