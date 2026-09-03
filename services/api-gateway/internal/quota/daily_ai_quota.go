// Package quota counts world creations against one caller's daily AI
// allowance and decides whether this create may spend an AI call.
//
// It lives in the gateway because the gateway is where the cost is incurred
// (section 9 of
// agent-system/plans/architecture/end-user-identity-and-ownership.md), and
// because the gateway is the only process holding both a Redis client and a
// verified identity at the moment a create arrives.
//
// **Nothing here refuses a request.** Over the limit produces a world from
// presets, which is decision 8: a rate-limited create screen is a dead end on
// the one screen the whole product exists for, and the visitor loses the AI
// call and nothing else. There is no 429 on this path and no error a caller
// has to handle.
package quota

import (
	"context"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/rs/zerolog/log"
)

// GenerationCounter is the counting half, satisfied by *edge.RedisStore. It
// returns the count INCLUDING the create being counted.
type GenerationCounter interface {
	IncrementDailyGenerationCount(ctx context.Context, callerKey string, at time.Time) (int, error)
}

// LimitReader resolves the two quota settings, satisfied by settings.Reader.
//
// It is an interface here for the same reason the reader takes one: this
// package must be testable without Redis, and settings.Reader answers a miss
// from its compiled-in default rather than asking auth-service. See
// internal/settings/reader.go for why that inversion exists.
type LimitReader interface {
	Integer(ctx context.Context, key contracts.SettingKey) int
}

// The two prefixes exist so that an account id and an anonymous id can never
// collide in the keyspace. Both are UUIDs, and while a UUID collision across
// the two tables is not a thing that happens, a counter shared between an
// account and an anonymous visitor would be, and the prefix costs nothing.
const (
	accountCallerKeyPrefix   = "account:"
	anonymousCallerKeyPrefix = "anonymous:"
)

// Caller is who a create is counted against.
//
// Exactly one field is ever set, which is the same invariant the generate
// command's two identity fields carry: the gateway drops the anonymous id the
// moment it has a verified account to name instead. Both nil is an ordinary
// state - a non-browser caller, or a browser with cookies disabled - and
// AllowanceFor answers it deliberately rather than by accident.
type Caller struct {
	AccountIdentifier   *string
	AnonymousIdentifier *string
}

// DailyAIQuota counts a create and says what its AI tier may do.
type DailyAIQuota struct {
	counter GenerationCounter
	limits  LimitReader
}

func NewDailyAIQuota(counter GenerationCounter, limits LimitReader) DailyAIQuota {
	return DailyAIQuota{counter: counter, limits: limits}
}

// Evaluate counts this create and returns the verdict that travels on the
// generate command.
//
// It always returns a verdict, never an error, and the two failure directions
// are chosen separately because they cost different things:
//
//   - **A caller with no identity at all gets no AI tier.** There is nothing
//     to count against, so a counter would never rise and the allowance would
//     be unlimited - which is precisely the script section 9.2 says the quota
//     exists to bound. A browser always sends one of the two; a caller that
//     sends neither is not a browser. It costs that caller a preset world,
//     which is the same thing the design already decided is acceptable.
//
//   - **A counter that cannot be read gets no AI tier either.** If Redis is
//     unreachable the count is unknowable, and a ceiling that fails open is
//     not a ceiling: every create during the outage would be a paid call with
//     nothing bounding it. Failing closed here is affordable for the one
//     reason this whole design rests on - the visitor still gets a real
//     world. This is the OPPOSITE of what settings.Reader does on a Redis
//     failure, and the difference is that a setting has a known-good default
//     while a spent allowance has no default at all.
func (quota DailyAIQuota) Evaluate(ctx context.Context, caller Caller, at time.Time) contracts.AIQuotaState {
	limitKey, callerKey, identified := caller.quotaIdentity()
	dailyLimit := quota.limits.Integer(ctx, limitKey)
	if !identified {
		return contracts.AIQuotaState{DailyLimit: dailyLimit, Exhausted: true}
	}
	generationsToday, err := quota.counter.IncrementDailyGenerationCount(ctx, callerKey, at)
	if err != nil {
		// Logged, unlike a settings cache miss: a miss is the normal state of
		// a fresh environment, while this is Redis being unreachable on the
		// create path and an operator wants to know.
		log.Warn().Err(err).Msg("count a world creation against the daily AI quota, withholding the AI tier for this create")
		return contracts.AIQuotaState{DailyLimit: dailyLimit, Exhausted: true}
	}
	return contracts.AIQuotaState{DailyLimit: dailyLimit, Exhausted: generationsToday > dailyLimit}
}

// quotaIdentity is which limit applies, which key counts, and whether there is
// anything to count at all.
//
// The account branch comes first because exactly one field is ever set and the
// account is the one that must win if both ever are: a signed-in visitor gets
// the account allowance, and an anonymous id left on a request by a stale
// cookie must not reduce it.
//
// The unidentified case still names the ANONYMOUS limit. It is reported to the
// visitor as the limit they were measured against, and reporting the account
// limit to somebody with no account would be a number they cannot reach.
func (caller Caller) quotaIdentity() (contracts.SettingKey, string, bool) {
	if caller.AccountIdentifier != nil && *caller.AccountIdentifier != "" {
		return contracts.SettingKeyQuotaAIDailyLimitAccount, accountCallerKeyPrefix + *caller.AccountIdentifier, true
	}
	if caller.AnonymousIdentifier != nil && *caller.AnonymousIdentifier != "" {
		return contracts.SettingKeyQuotaAIDailyLimitAnonymous, anonymousCallerKeyPrefix + *caller.AnonymousIdentifier, true
	}
	return contracts.SettingKeyQuotaAIDailyLimitAnonymous, "", false
}
