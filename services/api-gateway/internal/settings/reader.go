// Package settings resolves an operator-changeable policy value on the
// request path, from Redis or from the value compiled into this binary.
//
// It is one reader for the two `quota.*` limits — the gateway is the service
// that enforces the AI quota, so there is no alternative — and it takes
// nothing else from the gateway's existing configuration. Everything the
// gateway reads today is still an environment variable, deliberately (§9.3,
// batch 2).
package settings

import (
	"context"
	"errors"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/rs/zerolog/log"
)

// SettingCache is the read side of the settings mirror; auth-service is the
// only writer. *edge.RedisStore satisfies this without any change.
type SettingCache interface {
	GetSetting(ctx context.Context, key contracts.SettingKey) (string, error)
}

// Reader answers what a setting is worth right now.
//
// **A CACHE MISS USES THE COMPILED-IN DEFAULT AND ASKS NOBODY. Do not "fix"
// this into consistency with admin/auth.RevocationChecker.** That type falls
// back to a NATS request to auth-service on a miss, and it is right to: a
// revocation check that guesses is a security hole, so it is worth waking a
// service for.
//
// This is the one place §9.3 deliberately inverts that pattern, and the reason
// is the deployment fact rather than a preference. auth-service runs on a free
// tier and sleeps. The gateway enforces the AI quota on the create path. So a
// NATS fallback here would make every world creation after a quiet period wait
// 20-60 seconds for a cold start — on the one path the entire product exists
// for — in order to learn a number that is wrong by a few generations for one
// visitor at worst.
//
// What makes the miss safe is the other half of the mechanism: auth-service
// re-mirrors every setting into Redis at startup and on every write, with no
// TTL. So a miss means a flushed or unreachable Redis, not a stale value, and
// the default is a value the platform is required to behave correctly on
// (contracts.TestEveryDefaultIsInsideItsOwnDeclaredRange).
type Reader struct {
	cache SettingCache
}

func NewReader(cache SettingCache) Reader {
	return Reader{cache: cache}
}

// Integer resolves a declared integer setting. It returns a value and nothing
// else: there is no error for a caller to handle, because the compiled-in
// default is the correct answer to every way this can fail, and a caller given
// an error would have to choose between failing a world creation and ignoring
// it.
func (reader Reader) Integer(ctx context.Context, key contracts.SettingKey) int {
	definition, declared := contracts.SettingDefinitionFor(key)
	if !declared {
		// Unreachable through any call site: every caller passes a registry
		// constant. Handled rather than ignored, because the alternative is a
		// zero that reads as a real limit of nothing.
		log.Error().Str("setting_key", string(key)).Msg("resolve an integer setting the registry does not declare")
		return 0
	}
	value, err := definition.IntegerValue(reader.effectiveValue(ctx, definition))
	if err != nil {
		log.Error().Err(err).Str("setting_key", string(key)).Msg("the compiled-in default is not a valid integer")
		return 0
	}
	return value
}

// Duration resolves a declared duration setting. The gateway declares no
// duration setting today — both of its two are quota integers — and this
// exists because the reader is the mechanism rather than the two rows: batch 2
// moves the three gateway cache TTLs here, and a resolver that handles one of
// the four declared types is how the first of those ships as a value nothing
// reads.
func (reader Reader) Duration(ctx context.Context, key contracts.SettingKey) time.Duration {
	definition, declared := contracts.SettingDefinitionFor(key)
	if !declared {
		log.Error().Str("setting_key", string(key)).Msg("resolve a duration setting the registry does not declare")
		return 0
	}
	value, err := definition.DurationValue(reader.effectiveValue(ctx, definition))
	if err != nil {
		log.Error().Err(err).Str("setting_key", string(key)).Msg("the compiled-in default is not a valid duration")
		return 0
	}
	return value
}

// effectiveValue is the whole of the resolution order: the mirror, then the
// declared default. No third source, and in particular no NATS request — see
// the type comment.
//
// A miss is not logged. On a fresh environment with an empty settings table
// every read is a miss, and a log line on the create path for the normal case
// is noise that trains a reader to ignore the log. A cache ERROR is logged,
// because that is Redis being unreachable rather than a key being absent.
func (reader Reader) effectiveValue(ctx context.Context, definition contracts.SettingDefinition) string {
	mirrored, err := reader.cache.GetSetting(ctx, definition.Key)
	if errors.Is(err, edge.ErrCacheMiss) {
		return definition.DefaultValue
	}
	if err != nil {
		log.Warn().Err(err).Str("setting_key", string(definition.Key)).Msg("read the settings mirror, using the compiled-in default")
		return definition.DefaultValue
	}
	if validationError := definition.ValidateValue(mirrored); validationError != nil {
		// A mirrored value outside its declared bounds. auth-service validates
		// before writing, so this means the bounds were tightened after the
		// row was written — and bounds are code, so the code wins.
		log.Warn().Err(validationError).Str("setting_key", string(definition.Key)).Msg("the mirrored setting is outside its declared bounds, using the compiled-in default")
		return definition.DefaultValue
	}
	return mirrored
}
