package services

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/rs/zerolog/log"
)

// ErrSettingValueInvalid refuses a value outside its declared type or bounds.
//
// It carries no per-field detail, for the same reason ErrProfileInvalid does
// not: the GATEWAY validates a settings write against the very same registry
// before publishing, and answers the operator with the bound it broke. This
// error is the invariant behind that check, for the case where something
// publishes the subject directly — and an invariant does not need to be
// helpful, it needs to hold.
var ErrSettingValueInvalid = errors.New("that setting value is not valid")

// auditActionSettingUpdate records a policy change as `<key>: <old> -> <new>`.
//
// The target field carries the whole transition rather than just the key,
// because the audit log is the only history this platform keeps of a setting:
// system_settings holds the current value and who set it, and nothing else.
// A row saying only "somebody changed the quota" would answer none of the
// questions it would be read for.
const auditActionSettingUpdate = "setting_update"

// settingUpdateTargetFormat is that transition. `default` stands in for the
// absent previous row, because "there was no row" and "the row said nothing"
// are different facts and only the first one is true.
const settingUpdateTargetFormat = "%s: %s -> %s"

const absentPreviousSettingValue = "default"

// ListSettings joins the code-declared registry with whatever rows override
// it, and appends any orphan — a row whose key has left the registry.
//
// Declared settings come first and in DECLARATION order, which is the order
// the admin screen groups by; orphans come last, sorted, because they have no
// declared position to take. §9.3 leaves an orphan row in place rather than
// deleting it, deliberately unlike SyncPermissions, so it appears here as an
// unknown setting and removing it stays somebody's deliberate act.
func (service *AuthService) ListSettings(ctx context.Context) (contracts.SettingListResponseData, error) {
	rows, err := service.store.ListSystemSettings(ctx)
	if err != nil {
		return contracts.SettingListResponseData{}, err
	}
	rowsByKey := make(map[contracts.SettingKey]repositories.SystemSetting, len(rows))
	for _, row := range rows {
		rowsByKey[row.Key] = row
	}

	declared := contracts.DeclaredSettings()
	summaries := make([]contracts.SettingSummary, 0, len(declared)+len(rows))
	for _, definition := range declared {
		row, overridden := rowsByKey[definition.Key]
		summaries = append(summaries, service.declaredSettingSummary(definition, row, overridden))
	}
	for _, row := range rows {
		if _, declared := contracts.SettingDefinitionFor(row.Key); declared {
			continue
		}
		summaries = append(summaries, orphanSettingSummary(row))
	}
	return contracts.SettingListResponseData{Settings: summaries}, nil
}

// UpdateSetting validates, writes, audits and re-mirrors one setting.
//
// The order is deliberate. The row is authoritative, so it is written first;
// the audit row is written second, so the transition it records is the real
// one even if the mirror then fails; the Redis mirror is written last and its
// failure IS reported to the operator. Reporting success with a stale mirror
// would tell somebody their new quota is live when the gateway is still
// enforcing the old one — and the retry is safe, because writing the same row
// and the same mirror twice changes nothing.
func (service *AuthService) UpdateSetting(ctx context.Context, data contracts.SettingUpdateData) (contracts.SettingSummary, error) {
	key := contracts.SettingKey(strings.TrimSpace(data.Key))
	definition, declared := contracts.SettingDefinitionFor(key)
	if !declared {
		return contracts.SettingSummary{}, contracts.ErrSettingNotDeclared
	}
	if err := definition.ValidateValue(data.Value); err != nil {
		return contracts.SettingSummary{}, fmt.Errorf("%w: %v", ErrSettingValueInvalid, err)
	}
	value := strings.TrimSpace(data.Value)

	previousValue, err := service.store.UpsertSystemSetting(ctx, key, value, data.ActorAccountID)
	if err != nil {
		return contracts.SettingSummary{}, err
	}
	auditedPreviousValue := previousValue
	if auditedPreviousValue == "" {
		auditedPreviousValue = absentPreviousSettingValue
	}
	service.audit(ctx, &data.ActorAccountID, auditActionSettingUpdate,
		fmt.Sprintf(settingUpdateTargetFormat, key, auditedPreviousValue, value),
		auditResultSuccess, data.SourceAddress)

	if err := service.gatewayMirrorCache.SetSetting(ctx, key, value); err != nil {
		return contracts.SettingSummary{}, err
	}

	row, err := service.store.GetSystemSetting(ctx, key)
	if err != nil {
		return contracts.SettingSummary{}, err
	}
	return service.declaredSettingSummary(definition, row, true), nil
}

// MirrorSettingsToCache writes every DECLARED setting's effective value into
// Redis, and is called once at startup.
//
// This is what makes a flushed Redis self-heal on the next boot, and it is why
// the gateway is allowed to treat a cache miss as "use the default" rather
// than as a reason to wake this service (§9.3). It mirrors the effective value
// — the row if there is one, the default if there is not — so a hit answers
// the gateway's question completely and the default path stays a genuine last
// resort rather than the normal case for eight of nine keys.
//
// Orphan rows are not mirrored. Nothing reads them, and a key the gateway has
// no declaration for is a key it could not parse anyway.
//
// A failure here is fatal to the caller's judgement, not to this function: it
// returns the first error and stops, because a partial mirror is a state where
// some settings are live and some are not, and the operator needs to know
// which boot that was.
func (service *AuthService) MirrorSettingsToCache(ctx context.Context) error {
	for _, definition := range contracts.DeclaredSettings() {
		value := service.effectiveSettingValue(ctx, definition)
		if err := service.gatewayMirrorCache.SetSetting(ctx, definition.Key, value); err != nil {
			return fmt.Errorf("mirror setting %s: %w", definition.Key, err)
		}
	}
	return nil
}

// resolveIntegerSetting and resolveDurationSetting are what a call site uses
// instead of a config field. Neither returns an error, and that is a decision
// rather than an omission.
//
// Every setting's default is by construction a value the platform behaves
// correctly with — the empty-table invariant of §9.3, checked by
// TestEveryDefaultIsInsideItsOwnDeclaredRange. So whenever the stored value
// cannot be read or cannot be trusted, the default is not a guess, it is the
// right answer. Propagating the error instead would turn a hiccup while
// reading a policy number into a failed sign-in, which is strictly worse than
// locking an account after five attempts instead of the six an operator asked
// for.
func (service *AuthService) resolveIntegerSetting(ctx context.Context, key contracts.SettingKey) int {
	definition, declared := contracts.SettingDefinitionFor(key)
	if !declared {
		// Unreachable through any call site: every caller passes a constant
		// from the registry. It is handled rather than ignored because the
		// alternative is returning a zero that reads as a real limit.
		log.Error().Str("setting_key", string(key)).Msg("resolve integer setting that is not declared")
		return 0
	}
	value, err := definition.IntegerValue(service.effectiveSettingValue(ctx, definition))
	if err != nil {
		log.Error().Err(err).Str("setting_key", string(key)).Msg("declared default is not a valid integer")
		return 0
	}
	return value
}

func (service *AuthService) resolveDurationSetting(ctx context.Context, key contracts.SettingKey) time.Duration {
	definition, declared := contracts.SettingDefinitionFor(key)
	if !declared {
		log.Error().Str("setting_key", string(key)).Msg("resolve duration setting that is not declared")
		return 0
	}
	value, err := definition.DurationValue(service.effectiveSettingValue(ctx, definition))
	if err != nil {
		log.Error().Err(err).Str("setting_key", string(key)).Msg("declared default is not a valid duration")
		return 0
	}
	return value
}

// effectiveSettingValue reads the authoritative row, falling back to the
// default whenever there is no row or the row cannot be trusted.
//
// It reads POSTGRES, not the Redis mirror this service writes. auth-service
// owns the table, so going through its own mirror would make its behaviour
// depend on a cache it populated: a flushed Redis would silently revert this
// service's policy to the defaults while the rows still said otherwise. The
// gateway reads the mirror because it must not wake this service to ask; this
// service has no such constraint and every reason to read the truth.
//
// A row that no longer satisfies its declaration is ignored in favour of the
// default and logged. Bounds are code: a value that was legal when it was
// written and is not any more is not made legal by being in a database.
func (service *AuthService) effectiveSettingValue(ctx context.Context, definition contracts.SettingDefinition) string {
	defaultValue := service.settingDefaultValue(definition)
	row, err := service.store.GetSystemSetting(ctx, definition.Key)
	if errors.Is(err, repositories.ErrNotFound) {
		return defaultValue
	}
	if err != nil {
		log.Warn().Err(err).Str("setting_key", string(definition.Key)).Msg("read setting row, using the compiled-in default")
		return defaultValue
	}
	if validationError := definition.ValidateValue(row.Value); validationError != nil {
		log.Warn().Err(validationError).Str("setting_key", string(definition.Key)).Msg("stored setting is outside its declared bounds, using the compiled-in default")
		return defaultValue
	}
	return row.Value
}

// settingDefaultValue answers what a setting is worth with no row overriding
// it, which for five of the nine is still an environment variable.
//
// §9.3 keeps those five variables as the DEFAULT rather than deleting them:
// removing the fallback would break the empty-table invariant, and a value
// that has been deployed as an environment variable does not stop being one
// because a settings screen now exists. The other four were born as settings
// and have no environment variable at all — their default is the registry's
// own constant, which is the branch this switch falls through to.
//
// Written as an explicit switch rather than a map built from Config, so that
// every key whose default is not the registry's is named here and greppable.
// TestMigratedSettingDefaultsAgreeWithTheEnvironmentTheyReplace is what fails
// when one side of a pair moves alone.
func (service *AuthService) settingDefaultValue(definition contracts.SettingDefinition) string {
	switch definition.Key {
	case contracts.SettingKeyAuthTokenAdminAccessTTL:
		return contracts.FormatSettingDuration(service.cfg.AccessTokenTTL)
	case contracts.SettingKeyAuthTokenAdminRefreshTTL:
		return contracts.FormatSettingDuration(service.cfg.RefreshTokenTTL)
	case contracts.SettingKeyAuthTokenInviteTTL:
		return contracts.FormatSettingDuration(service.cfg.InviteTokenTTL)
	case contracts.SettingKeyAuthLockoutMaximumFailedAttempts:
		return strconv.Itoa(service.cfg.MaximumFailedAttempts)
	case contracts.SettingKeyAuthLockoutDuration:
		return contracts.FormatSettingDuration(service.cfg.LockoutDuration)
	default:
		return definition.DefaultValue
	}
}

func (service *AuthService) declaredSettingSummary(definition contracts.SettingDefinition, row repositories.SystemSetting, overridden bool) contracts.SettingSummary {
	defaultValue := service.settingDefaultValue(definition)
	summary := contracts.SettingSummary{
		Key:           string(definition.Key),
		Type:          definition.Type,
		Description:   definition.Description,
		Value:         defaultValue,
		DefaultValue:  defaultValue,
		IsDeclared:    true,
		IsOverridden:  overridden,
		AllowedValues: definition.AllowedValues,
	}
	switch definition.Type {
	case contracts.SettingTypeInteger:
		summary.Minimum = strconv.Itoa(definition.MinimumInteger)
		summary.Maximum = strconv.Itoa(definition.MaximumInteger)
	case contracts.SettingTypeDuration:
		summary.Minimum = contracts.FormatSettingDuration(definition.MinimumDuration)
		summary.Maximum = contracts.FormatSettingDuration(definition.MaximumDuration)
	}
	if overridden {
		// The row is shown even when it no longer satisfies its declaration,
		// unlike effectiveSettingValue which ignores it. The screen's job is
		// to show an operator what is stored so they can correct it; hiding an
		// out-of-bounds row would leave them looking at a default with no
		// explanation for why the platform disagrees with the database.
		summary.Value = row.Value
		summary.UpdatedAt = &row.UpdatedAt
		if row.UpdatedByAccountID != nil {
			summary.UpdatedByAccountID = *row.UpdatedByAccountID
		}
	}
	return summary
}

// orphanSettingSummary describes a row whose key has left the registry. It
// carries no type, no default and no bounds, because there is no declaration
// left to take them from — which is exactly what the screen renders as an
// unknown setting.
func orphanSettingSummary(row repositories.SystemSetting) contracts.SettingSummary {
	summary := contracts.SettingSummary{
		Key:          string(row.Key),
		Value:        row.Value,
		IsDeclared:   false,
		IsOverridden: true,
		UpdatedAt:    &row.UpdatedAt,
	}
	if row.UpdatedByAccountID != nil {
		summary.UpdatedByAccountID = *row.UpdatedByAccountID
	}
	return summary
}
