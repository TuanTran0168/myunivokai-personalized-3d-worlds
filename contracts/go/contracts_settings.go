package contracts

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SettingKey names one operator-changeable policy value. Its authoritative
// copy is a `system_settings` row in `myunivokai_auth`, mirrored into Redis
// for the gateway to read — see §9.3 of
// agent-system/plans/architecture/end-user-identity-and-ownership.md.
//
// The scheme is `<domain>.<group>.<subject>.<thing>`, lower snake within a
// segment and dots between, constrained by settingKeyPattern. The segment
// COUNT is not fixed and the pattern does not require four: `auth.lockout.
// duration` needs three and a fourth would be padding. What the scheme
// actually fixes is that the varying part comes last, so siblings sort
// together, and that `<domain>` names WHAT THE SETTING GOVERNS rather than
// the service that stores it — which is why the two quota ceilings are
// `quota.*` while their rows live in auth-service's database.
//
// A dot is not a legal character in a shell identifier, so a key in this form
// can only ever be a database row and an UPPER_SNAKE name can only ever be an
// environment variable. That is a guarantee rather than a convention, and it
// matters because for the five migrated settings both exist at once on
// purpose: the environment variable stays as that setting's default.
type SettingKey string

// The nine settings of batch 1. All nine are auth-service's own values, by the
// owner's narrowing of the audit in §9.3 — five migrated from an environment
// variable that stays as their default, and four born as settings with a
// compiled-in constant and no environment variable at all.
const (
	SettingKeyQuotaAIDailyLimitAnonymous SettingKey = "quota.ai.daily_limit.anonymous"
	SettingKeyQuotaAIDailyLimitAccount   SettingKey = "quota.ai.daily_limit.account"

	SettingKeyAuthTokenAdminAccessTTL  SettingKey = "auth.token.admin.access_ttl"
	SettingKeyAuthTokenAdminRefreshTTL SettingKey = "auth.token.admin.refresh_ttl"
	SettingKeyAuthTokenWebAccessTTL    SettingKey = "auth.token.web.access_ttl"
	SettingKeyAuthTokenWebRefreshTTL   SettingKey = "auth.token.web.refresh_ttl"
	SettingKeyAuthTokenInviteTTL       SettingKey = "auth.token.invite_ttl"

	SettingKeyAuthLockoutMaximumFailedAttempts SettingKey = "auth.lockout.max_failed_attempts"
	SettingKeyAuthLockoutDuration              SettingKey = "auth.lockout.duration"
)

// SettingType decides how a stored value is parsed and how the admin screen
// renders its input. These four and no more, because they are the four the
// config loaders already have (`get`, `getInt`, `getBool`, `getDuration`) and
// a setting exists to replace one of those reads.
//
// Batch 1 declares only Integer and Duration. String and Boolean are
// implemented and tested rather than deferred, because the admin screen has to
// switch on the type either way and a switch with two live branches and two
// unwritten ones is how the third setting ships broken.
type SettingType string

const (
	SettingTypeString   SettingType = "string"
	SettingTypeInteger  SettingType = "int"
	SettingTypeBoolean  SettingType = "bool"
	SettingTypeDuration SettingType = "duration"
)

func (settingType SettingType) Valid() bool {
	switch settingType {
	case SettingTypeString, SettingTypeInteger, SettingTypeBoolean, SettingTypeDuration:
		return true
	default:
		return false
	}
}

// settingKeyPattern is the scheme from §9.3, enforced rather than described.
var settingKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)

// ErrSettingNotDeclared refuses a write to a key no Go declaration names. The
// registry is the source of truth for what a setting IS, so a key it does not
// name has no type and no bounds to validate against, which makes accepting
// the write the same as accepting an unvalidated one.
var ErrSettingNotDeclared = errors.New("that setting key is not declared")

const (
	// hoursPerDay is the whole of the `d` unit ParseSettingDuration adds. It
	// is 24 exactly: this arithmetic never sees a timezone, so a day here is a
	// fixed span rather than a calendar one.
	hoursPerDay = 24

	// dayUnitSuffix is the one unit Go's own duration syntax lacks and every
	// value in this registry needs. `168h` and `7d` are the same duration and
	// only one of them can be checked by an operator at a glance.
	dayUnitSuffix = "d"
)

// The nine defaults, as the text an operator would type. Text rather than
// typed values so that a default and a stored row go through the SAME parser
// and the SAME bounds check — which is what lets a test prove every default is
// inside its own declared range instead of leaving that to be discovered by
// the first environment with an empty settings table.
const (
	// Five free AI generations a day for a visitor with no account, twenty-five
	// for one who signed up. The ratio is the product argument for signing up
	// and the absolute numbers are the cost ceiling (§9.2); both are the
	// reason these two were the settings this mechanism was built for.
	defaultAnonymousDailyAIGenerationLimit = "5"
	defaultAccountDailyAIGenerationLimit   = "25"

	// Ten minutes for a staff access token, seven days for the product's.
	// The gap is defensible only because the gateway checks the Redis
	// tokenVersion on every request rather than only on refresh, so
	// revocation is immediate at either lifetime and the number decides how
	// often a refresh round trip happens — see §4.4.
	defaultAdminAccessTokenLifetime  = "10m"
	defaultAdminRefreshTokenLifetime = "14d"
	defaultWebAccessTokenLifetime    = "7d"

	// Three months, declared as ninety days because a duration cannot express
	// a calendar month and rounding it here explicitly beats leaving a reader
	// to work out which month was meant.
	defaultWebRefreshTokenLifetime = "90d"

	defaultInviteTokenLifetime = "7d"

	// Five consecutive failures, then fifteen minutes locked. Not a token
	// lifetime and deliberately not named as one — they are grouped under
	// `auth.lockout.*` so an operator reading the screen cannot mistake the
	// lockout window for a session length.
	defaultMaximumFailedAttempts = "5"
	defaultLockoutDuration       = "15m"
)

// The declared ranges. Every int and duration setting has one, and a write
// outside it is refused: bounds are code, never data, and that is the whole of
// what makes exposing a security-relevant number to a web form safe.
const (
	// Zero is a legitimate quota — it means no free AI at all, which is the
	// switch an operator reaches for when the bill arrives. The ceiling is
	// what stops a typo from becoming an unbounded spend.
	minimumDailyAIGenerationLimit = 0
	maximumDailyAIGenerationLimit = 1000

	// One failure minimum. Zero would lock every account on its zeroth failed
	// attempt, including the one an operator would use to put the value back —
	// the same bootstrap trap §9.3 refuses `ADMIN_ROUTES_ENABLED` for.
	minimumFailedAttempts = 1
	maximumFailedAttempts = 100

	minimumLockoutDuration = time.Minute
	maximumLockoutDuration = hoursPerDay * time.Hour

	minimumInviteTokenLifetime = time.Hour
	maximumInviteTokenLifetime = 30 * hoursPerDay * time.Hour
)

// The four token lifetime ranges, declared together because of the one
// property they are chosen for.
//
// Each audience's ACCESS range ends exactly where its REFRESH range begins, so
// no pair of values an operator can write leaves an access token outliving the
// refresh token that is supposed to renew it. A per-key bound cannot express a
// cross-key invariant — so rather than build cross-key validation for one
// case, the ranges are picked to make the violation unexpressible.
//
// Widening either maximum later therefore requires moving the matching
// refresh minimum with it. TestAccessLifetimeRangesCannotCrossTheirRefreshRanges
// is what fails when only one of the two moves.
const (
	minimumAdminAccessTokenLifetime  = time.Minute
	maximumAdminAccessTokenLifetime  = hoursPerDay * time.Hour
	minimumAdminRefreshTokenLifetime = maximumAdminAccessTokenLifetime
	maximumAdminRefreshTokenLifetime = 90 * hoursPerDay * time.Hour

	minimumWebAccessTokenLifetime  = 5 * time.Minute
	maximumWebAccessTokenLifetime  = 30 * hoursPerDay * time.Hour
	minimumWebRefreshTokenLifetime = maximumWebAccessTokenLifetime
	maximumWebRefreshTokenLifetime = 365 * hoursPerDay * time.Hour
)

// SettingDefinition is one entry of the code-declared registry: what a setting
// is called, what type it holds, what it does when no row overrides it, and
// the range a row is allowed to sit in.
//
// Only the bound fields matching Type are read. Declaring them as named fields
// per type rather than as one `any` keeps the range greppable and keeps the
// validator a plain switch; TestEveryDeclaredSettingBoundsItsOwnType is what
// refuses a declaration that fills the wrong pair or leaves its own empty.
//
// Description is rendered verbatim by the admin Settings screen, which is why
// the `auth.token.web.*` entries say "personalization web app" in words while
// their keys say `web`: the operator reads the app's name, and the code keeps
// the one vocabulary §17 freezes for `aud=web`.
type SettingDefinition struct {
	Key         SettingKey
	Type        SettingType
	Description string
	// DefaultValue is the behaviour with no row and an empty Redis, and is
	// held as text so it is parsed and bounds-checked by the same code an
	// operator's value is.
	DefaultValue string

	MinimumInteger int
	MaximumInteger int

	MinimumDuration time.Duration
	MaximumDuration time.Duration

	// AllowedValues closes a string setting's vocabulary. Empty means any
	// non-empty string up to MaximumStringLength. Batch 1 declares no string
	// setting, so both are exercised only by tests today.
	AllowedValues       []string
	MaximumStringLength int
}

// declaredSettings is the single source of truth for what settings exist.
//
// It is pinned by TestDeclaredSettingsAreDeclaredDeliberately in the same
// spirit as auth-service's enforcedPermissions: the list cannot check itself,
// so the test names every key and fails when one drifts in or out.
//
// It lives in `contracts` rather than in auth-service because BOTH sides need
// it and neither can import the other. auth-service owns the table and
// validates the writes; the gateway needs the two `quota.*` defaults to answer
// a Redis miss without asking auth-service anything (§9.3's one deliberate
// divergence from RevocationChecker). Declaring it twice would put the value 5
// in two services and let them disagree.
var declaredSettings = []SettingDefinition{
	{
		Key:            SettingKeyQuotaAIDailyLimitAnonymous,
		Type:           SettingTypeInteger,
		Description:    "AI generations a day for a visitor with no account. Over the limit a world is still produced, from presets instead of the AI provider — it is never refused.",
		DefaultValue:   defaultAnonymousDailyAIGenerationLimit,
		MinimumInteger: minimumDailyAIGenerationLimit,
		MaximumInteger: maximumDailyAIGenerationLimit,
	},
	{
		Key:            SettingKeyQuotaAIDailyLimitAccount,
		Type:           SettingTypeInteger,
		Description:    "AI generations a day for a signed-in account. The gap between this and the anonymous limit is the product's reason to sign up.",
		DefaultValue:   defaultAccountDailyAIGenerationLimit,
		MinimumInteger: minimumDailyAIGenerationLimit,
		MaximumInteger: maximumDailyAIGenerationLimit,
	},
	{
		Key:             SettingKeyAuthTokenAdminAccessTTL,
		Type:            SettingTypeDuration,
		Description:     "Access token lifetime for the admin console (token audience `admin`). Short by design: staff hold the permissions that change everything else on this screen.",
		DefaultValue:    defaultAdminAccessTokenLifetime,
		MinimumDuration: minimumAdminAccessTokenLifetime,
		MaximumDuration: maximumAdminAccessTokenLifetime,
	},
	{
		Key:             SettingKeyAuthTokenAdminRefreshTTL,
		Type:            SettingTypeDuration,
		Description:     "Refresh token lifetime for the admin console — how long staff can stay signed in without entering a password again.",
		DefaultValue:    defaultAdminRefreshTokenLifetime,
		MinimumDuration: minimumAdminRefreshTokenLifetime,
		MaximumDuration: maximumAdminRefreshTokenLifetime,
	},
	{
		Key:             SettingKeyAuthTokenWebAccessTTL,
		Type:            SettingTypeDuration,
		Description:     "Access token lifetime for the personalization web app (token audience `web`). Long by design, and safe because the gateway rechecks revocation on every request rather than only at refresh.",
		DefaultValue:    defaultWebAccessTokenLifetime,
		MinimumDuration: minimumWebAccessTokenLifetime,
		MaximumDuration: maximumWebAccessTokenLifetime,
	},
	{
		Key:             SettingKeyAuthTokenWebRefreshTTL,
		Type:            SettingTypeDuration,
		Description:     "Refresh token lifetime for the personalization web app — how long a visitor stays signed in on a device they do not sign out of.",
		DefaultValue:    defaultWebRefreshTokenLifetime,
		MinimumDuration: minimumWebRefreshTokenLifetime,
		MaximumDuration: maximumWebRefreshTokenLifetime,
	},
	{
		Key:             SettingKeyAuthTokenInviteTTL,
		Type:            SettingTypeDuration,
		Description:     "How long a staff invite token stays usable. One audience only — the product has no invite flow.",
		DefaultValue:    defaultInviteTokenLifetime,
		MinimumDuration: minimumInviteTokenLifetime,
		MaximumDuration: maximumInviteTokenLifetime,
	},
	{
		Key:            SettingKeyAuthLockoutMaximumFailedAttempts,
		Type:           SettingTypeInteger,
		Description:    "Consecutive failed sign-ins before an account is locked. Applies to both audiences.",
		DefaultValue:   defaultMaximumFailedAttempts,
		MinimumInteger: minimumFailedAttempts,
		MaximumInteger: maximumFailedAttempts,
	},
	{
		Key:             SettingKeyAuthLockoutDuration,
		Type:            SettingTypeDuration,
		Description:     "How long an account stays locked after that many failed sign-ins. Not a session length.",
		DefaultValue:    defaultLockoutDuration,
		MinimumDuration: minimumLockoutDuration,
		MaximumDuration: maximumLockoutDuration,
	},
}

// DeclaredSettings returns the registry in declaration order, which is the
// order the admin screen renders and therefore groups by. A copy, so a caller
// browsing the registry cannot edit it.
func DeclaredSettings() []SettingDefinition {
	return append([]SettingDefinition(nil), declaredSettings...)
}

// SettingDefinitionFor looks up one declared setting. The false return is what
// makes an orphan row — a key deleted from this registry while its row remains
// — readable as "unknown" rather than deleted: §9.3 leaves the row in place so
// that removing it stays a deliberate act.
func SettingDefinitionFor(key SettingKey) (SettingDefinition, bool) {
	for _, definition := range declaredSettings {
		if definition.Key == key {
			return definition, true
		}
	}
	return SettingDefinition{}, false
}

// ValidateValue reports whether raw is an acceptable value for this setting:
// parseable as its type, and inside its declared range.
func (definition SettingDefinition) ValidateValue(raw string) error {
	switch definition.Type {
	case SettingTypeInteger:
		_, err := definition.IntegerValue(raw)
		return err
	case SettingTypeDuration:
		_, err := definition.DurationValue(raw)
		return err
	case SettingTypeBoolean:
		_, err := definition.BooleanValue(raw)
		return err
	case SettingTypeString:
		_, err := definition.StringValue(raw)
		return err
	default:
		return fmt.Errorf("setting %s has an unknown type %q", definition.Key, definition.Type)
	}
}

func (definition SettingDefinition) IntegerValue(raw string) (int, error) {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("setting %s must be a whole number", definition.Key)
	}
	if value < definition.MinimumInteger || value > definition.MaximumInteger {
		return 0, fmt.Errorf("setting %s must be between %d and %d", definition.Key, definition.MinimumInteger, definition.MaximumInteger)
	}
	return value, nil
}

func (definition SettingDefinition) DurationValue(raw string) (time.Duration, error) {
	value, err := ParseSettingDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("setting %s must be a duration such as 30m, 12h or 7d", definition.Key)
	}
	if value < definition.MinimumDuration || value > definition.MaximumDuration {
		return 0, fmt.Errorf("setting %s must be between %s and %s", definition.Key,
			FormatSettingDuration(definition.MinimumDuration), FormatSettingDuration(definition.MaximumDuration))
	}
	return value, nil
}

// BooleanValue accepts only the two canonical spellings. Not strconv.ParseBool,
// which also admits "1", "t", "TRUE" and "F": a setting is written by one
// screen and read back by an operator comparing it to another row, and five
// spellings of true make two rows that agree look like two that differ.
func (definition SettingDefinition) BooleanValue(raw string) (bool, error) {
	switch strings.TrimSpace(raw) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("setting %s must be true or false", definition.Key)
	}
}

func (definition SettingDefinition) StringValue(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("setting %s must not be empty", definition.Key)
	}
	if len(definition.AllowedValues) > 0 {
		for _, allowed := range definition.AllowedValues {
			if value == allowed {
				return value, nil
			}
		}
		return "", fmt.Errorf("setting %s must be one of %s", definition.Key, strings.Join(definition.AllowedValues, ", "))
	}
	if definition.MaximumStringLength > 0 && len([]rune(value)) > definition.MaximumStringLength {
		return "", fmt.Errorf("setting %s must be at most %d characters", definition.Key, definition.MaximumStringLength)
	}
	return value, nil
}

// ParseSettingDuration reads Go's own duration syntax plus one extension: a
// whole number of days, written `7d`.
//
// The extension exists because every duration in this registry is measured in
// days or minutes and Go's syntax stops at hours. An operator asked to type
// `2160h` for three months cannot check it at a glance, and `21600h` is one
// keystroke away — which is precisely the class of mistake the declared bounds
// then have to catch. Whole days only: `1.5d` is refused rather than rounded,
// because a fractional day is expressible as hours and a silent rounding is
// not something a settings screen should ever do.
func ParseSettingDuration(raw string) (time.Duration, error) {
	trimmed := strings.TrimSpace(raw)
	if dayCount, hasDayUnit := strings.CutSuffix(trimmed, dayUnitSuffix); hasDayUnit {
		days, err := strconv.Atoi(dayCount)
		if err != nil {
			return 0, fmt.Errorf("%q is not a whole number of days", trimmed)
		}
		return time.Duration(days) * hoursPerDay * time.Hour, nil
	}
	return time.ParseDuration(trimmed)
}

// FormatSettingDuration is ParseSettingDuration's inverse for the values it can
// express exactly: a whole number of days comes back as `7d`, and everything
// else keeps Go's own spelling. It is what puts a readable default in front of
// an operator and what makes a bounds message name the same form the input
// takes.
func FormatSettingDuration(value time.Duration) string {
	day := hoursPerDay * time.Hour
	if value >= day && value%day == 0 {
		return strconv.FormatInt(int64(value/day), 10) + dayUnitSuffix
	}
	return value.String()
}

// SettingSummary is one row of the admin Settings screen: the declared shape
// joined with whatever row overrides it, if any.
//
// IsDeclared is false for an orphan — a row whose key has left the registry.
// §9.3 leaves such a row in place rather than deleting it, deliberately unlike
// SyncPermissions, so the screen shows it as unknown and removing it stays
// somebody's decision. An orphan carries no Type, DefaultValue or bounds,
// because there is no longer any declaration to take them from.
type SettingSummary struct {
	Key         string      `json:"key"`
	Type        SettingType `json:"type,omitempty"`
	Description string      `json:"description,omitempty"`
	// Value is what the platform is actually using: the row if there is one,
	// the default otherwise.
	Value        string `json:"value"`
	DefaultValue string `json:"defaultValue,omitempty"`
	IsDeclared   bool   `json:"isDeclared"`
	// IsOverridden reports that a row exists, which is a different question
	// from whether Value differs from DefaultValue — a row that restates the
	// default is still an operator's decision and still shows who made it.
	IsOverridden bool `json:"isOverridden"`

	Minimum       string   `json:"minimum,omitempty"`
	Maximum       string   `json:"maximum,omitempty"`
	AllowedValues []string `json:"allowedValues,omitempty"`

	UpdatedByAccountID string     `json:"updatedByAccountId,omitempty"`
	UpdatedAt          *time.Time `json:"updatedAt,omitempty"`
}

type SettingListResponseData struct {
	Settings []SettingSummary `json:"settings"`
}

// SettingUpdateData writes one setting. ActorAccountID is set by the gateway
// from the verified access token and never read from the request body, exactly
// as AccountProfileUpdateData's account id is: the row records who changed a
// policy number, and a field a caller could set would make that record a
// suggestion.
type SettingUpdateData struct {
	Key            string `json:"key"`
	Value          string `json:"value"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

func (data SettingUpdateData) Validate() error {
	key := SettingKey(strings.TrimSpace(data.Key))
	if !IsValidSettingKey(key) {
		return errors.New("key must be a dotted lower-case setting key")
	}
	definition, declared := SettingDefinitionFor(key)
	if !declared {
		return ErrSettingNotDeclared
	}
	if !IsUUID(data.ActorAccountID) {
		return errors.New("actorAccountId must be a UUID")
	}
	return definition.ValidateValue(data.Value)
}

func IsValidSettingKey(key SettingKey) bool {
	return settingKeyPattern.MatchString(string(key))
}
