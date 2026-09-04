package edge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/redis/go-redis/v9"
)

var ErrCacheMiss = errors.New("cache miss")

const (
	rateLimitKeySegment     = "rate"
	cacheKeySegment         = "cache"
	authTokenVersionSegment = "auth:tokenversion"
	// settingKeySegment matches auth-service's own constant. It is singular
	// because the key names ONE setting, and it is why a setting key may not
	// contain a colon (contracts.settingKeyPattern refuses one): the colon is
	// this keyspace's separator.
	settingKeySegment = "setting"
	// identityFailureSegment counts failed sign-in attempts PER EMAIL, which
	// is a different question from the per-IP token bucket under
	// rateLimitKeySegment and must never share a key with it: the attack this
	// counts is one account probed from many addresses, and the attack that
	// counts is one address probing many accounts. Both exist, and a single
	// counter answers neither.
	identityFailureSegment = "auth:identity:failures"
	// dailyGenerationQuotaSegment holds one counter per caller per UTC day.
	//
	// A key PREFIX and not policy, which is the distinction section 9.3 draws:
	// the two limits this counter is compared against are settings rows an
	// operator changes, and where the count lives is not. So this stays a
	// named constant here while the numbers stay out of this file entirely.
	dailyGenerationQuotaSegment = "quota:ai:daily"
	// dailyGenerationQuotaDayFormat is the same UTC day stamp
	// wakeStatsDayFormat uses, and deliberately a separate constant: these
	// two counters answer unrelated questions and a shared constant would
	// invite a change to one to be made for the other's sake.
	dailyGenerationQuotaDayFormat = "2006-01-02"
	// dailyGenerationQuotaExpirySlack keeps a counter alive slightly past the
	// day it names, so the last caller before UTC midnight cannot be handed a
	// fresh allowance by an expiry that fired a moment early.
	dailyGenerationQuotaExpirySlack = time.Hour
	wakeKeySegment                  = "wake"
	// Distinct segments rather than a suffix on wakeKeySegment, so a wake
	// lock for a service can never be mistaken for a counter or the reverse.
	wakeCountKeySegment    = "wake:count"
	wakeSeenKeySegment     = "wake:seen"
	wakeFailuresKeySegment = "wake:failures"
	minimumRetryDelay      = time.Millisecond

	// wakeStatsDayFormat keys counters by UTC day. UTC and not local time
	// because the process reading these runs in whatever region the host
	// picked, and a chart whose buckets shift when a service is redeployed
	// elsewhere is worse than one that never matches anybody's midnight.
	wakeStatsDayFormat = "2006-01-02"

	// wakeStatsRetention expires the counters instead of a cleanup job. These
	// are operational history, not records: ninety days is long enough to see
	// whether a month of traffic changed how often services sleep, and short
	// enough that a forgotten key never becomes permanent residency in a
	// store whose whole job is ephemeral state.
	wakeStatsRetention = 90 * 24 * time.Hour

	// wakeFailureWindow is how long an unanswered wake stays counted.
	//
	// It is short on purpose. The counter answers "how many wake calls in the
	// recent past went unanswered", and once wakes stop being sent - which is
	// what happens the moment the service starts replying - the question is
	// moot and the count must clear itself. Each new wake refreshes the
	// window, so a genuinely dead service keeps its tally while a recovered
	// one loses it without anything having to remember to reset it.
	wakeFailureWindow = 5 * time.Minute
)

var tokenBucketScript = redis.NewScript(`
local current_time = redis.call('TIME')
local now = tonumber(current_time[1]) + tonumber(current_time[2]) / 1000000
local values = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(values[1])
local updated_at = tonumber(values[2])
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
if tokens == nil then tokens = capacity end
if updated_at == nil then updated_at = now end
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * rate)
local allowed = 0
local retry_milliseconds = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
else
  retry_milliseconds = math.ceil((1 - tokens) / rate * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 2000))
return {allowed, retry_milliseconds}
`)

type RedisStore struct {
	client    *redis.Client
	keyPrefix string
}

func NewRedisStore(redisURL, keyPrefix string) (*RedisStore, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &RedisStore{client: redis.NewClient(options), keyPrefix: strings.TrimSuffix(keyPrefix, ":")}, nil
}

func (store *RedisStore) Allow(ctx context.Context, route, clientIdentifier string, requestsPerSecond float64, burst int) (bool, time.Duration, error) {
	key := store.key(rateLimitKeySegment, sanitizeKeyPart(route), sanitizeKeyPart(clientIdentifier))
	result, err := tokenBucketScript.Run(ctx, store.client, []string{key}, requestsPerSecond, burst).Slice()
	if err != nil {
		return false, 0, err
	}
	if len(result) != 2 {
		return false, 0, errors.New("unexpected Redis rate limit result")
	}
	allowed, allowedValid := result[0].(int64)
	retryMilliseconds, retryValid := result[1].(int64)
	if !allowedValid || !retryValid {
		return false, 0, errors.New("invalid Redis rate limit result")
	}
	retryDelay := time.Duration(retryMilliseconds) * time.Millisecond
	if retryDelay > 0 && retryDelay < minimumRetryDelay {
		retryDelay = minimumRetryDelay
	}
	return allowed == 1, retryDelay, nil
}

func (store *RedisStore) Get(ctx context.Context, namespace, identifier string) ([]byte, error) {
	payload, err := store.client.Get(ctx, store.key(cacheKeySegment, namespace, identifier)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrCacheMiss
	}
	return payload, err
}

func (store *RedisStore) Set(ctx context.Context, namespace, identifier string, payload []byte, timeToLive time.Duration) error {
	return store.client.Set(ctx, store.key(cacheKeySegment, namespace, identifier), payload, timeToLive).Err()
}

func (store *RedisStore) Delete(ctx context.Context, namespace, identifier string) error {
	return store.client.Del(ctx, store.key(cacheKeySegment, namespace, identifier)).Err()
}

// GetTokenVersion and SetTokenVersion read/write the same
// <prefix>:auth:tokenversion:<accountId> key auth-service writes on disable
// or password change — a plain key, not under the "cache:" namespace the
// rest of this store uses, so both processes agree on it without either
// hardcoding the other's prefix. See
// agent-system/plans/services/auth-and-admin-plan.md#how-b-works and
// services/auth-service/internal/redis/client.go.
func (store *RedisStore) GetTokenVersion(ctx context.Context, accountID string) (int, error) {
	raw, err := store.client.Get(ctx, store.key(authTokenVersionSegment, accountID)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, ErrCacheMiss
	}
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(raw)
}

func (store *RedisStore) SetTokenVersion(ctx context.Context, accountID string, tokenVersion int, timeToLive time.Duration) error {
	return store.client.Set(ctx, store.key(authTokenVersionSegment, accountID), strconv.Itoa(tokenVersion), timeToLive).Err()
}

// RecordIdentityFailure increments the failure count for one identity and
// returns the new value. The window is refreshed on every failure, so a
// steady trickle of attempts stays counted while a genuine typo ages out.
//
// identityKey is a HASH of the email address, never the address itself - see
// IdentityFailureKey. The counter needs to distinguish identities, not to be
// able to read them back, and Redis is shared infrastructure whose keyspace
// is visible to anything holding the connection string.
//
// A pipeline rather than two round trips, and INCR before EXPIRE so a key
// that already exists cannot lose its count to a race with its own refresh.
func (store *RedisStore) RecordIdentityFailure(ctx context.Context, identityKey string, window time.Duration) (int, error) {
	key := store.key(identityFailureSegment, sanitizeKeyPart(identityKey))
	pipeline := store.client.Pipeline()
	increment := pipeline.Incr(ctx, key)
	pipeline.Expire(ctx, key, window)
	if _, err := pipeline.Exec(ctx); err != nil {
		return 0, err
	}
	return int(increment.Val()), nil
}

// GetSetting reads one mirrored setting. auth-service is the only writer, and
// it writes with NO TTL — so a miss means a flushed or unreachable Redis
// rather than an expired value, which is what lets settings.Reader answer a
// miss from its compiled-in default instead of asking auth-service. See that
// type's comment for why this is the one cache in the gateway whose miss must
// NOT fall back to a NATS request.
func (store *RedisStore) GetSetting(ctx context.Context, key contracts.SettingKey) (string, error) {
	value, err := store.client.Get(ctx, store.key(settingKeySegment, string(key))).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// IncrementDailyGenerationCount counts one world creation against one caller
// and returns the count INCLUDING this one, so the caller compares it against
// the limit directly rather than remembering to add one.
//
// The key names its own UTC day, so a new day starts a new counter with no
// reset to perform, and the TTL only has to outlive that day - which is what
// removes the cleanup job section 9 says there must not be. The expiry is
// refreshed on every increment, which is harmless: every increment that
// touches this key belongs to the day the key names.
//
// UTC and not local time, for the reason wakeStatsDayFormat gives: the process
// runs in whatever region the host picked, and a daily allowance that resets
// at a different moment after a redeploy is worse than one that never matches
// anybody's midnight.
//
// callerKey is an account id or an anonymous id, NEVER an address. A per-IP
// counter is shared by everyone behind one NAT and is bypassed by anyone with
// a second address, which is why the anonymous id exists at all (section 6.3).
func (store *RedisStore) IncrementDailyGenerationCount(ctx context.Context, callerKey string, at time.Time) (int, error) {
	utcMoment := at.UTC()
	key := store.key(dailyGenerationQuotaSegment, utcMoment.Format(dailyGenerationQuotaDayFormat), sanitizeKeyPart(callerKey))
	pipeline := store.client.Pipeline()
	increment := pipeline.Incr(ctx, key)
	pipeline.Expire(ctx, key, timeRemainingInUTCDay(utcMoment))
	if _, err := pipeline.Exec(ctx); err != nil {
		return 0, err
	}
	return int(increment.Val()), nil
}

// timeRemainingInUTCDay is how long is left of the UTC day a moment falls in,
// which is exactly how long its counter has to survive.
//
// Plus one hour of slack, and the slack is not superstition: a counter that
// expired a few milliseconds before the day it names ended would give the last
// caller of the day a fresh allowance. An hour of overlap costs one key per
// caller per hour and closes that seam without a clock assumption.
func timeRemainingInUTCDay(moment time.Time) time.Duration {
	utcMoment := moment.UTC()
	startOfNextDay := time.Date(utcMoment.Year(), utcMoment.Month(), utcMoment.Day(), 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, 1)
	return startOfNextDay.Sub(utcMoment) + dailyGenerationQuotaExpirySlack
}

// IdentityFailureCount reads the tally without touching it. A missing key is
// zero rather than an error: never having failed and having aged out of the
// window are the same state as far as the next attempt is concerned.
func (store *RedisStore) IdentityFailureCount(ctx context.Context, identityKey string) (int, error) {
	raw, err := store.client.Get(ctx, store.key(identityFailureSegment, sanitizeKeyPart(identityKey))).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(raw)
}

// ClearIdentityFailures drops the tally after a successful sign-in, so a
// person who mistyped their password four times and then got it right is not
// one attempt away from being throttled on their next visit.
func (store *RedisStore) ClearIdentityFailures(ctx context.Context, identityKey string) error {
	return store.client.Del(ctx, store.key(identityFailureSegment, sanitizeKeyPart(identityKey))).Err()
}

// IdentityFailureKey derives the counter key for an email address: lowercased
// and trimmed to match auth-service's own normalizeEmail, so "A@b.com " and
// "a@b.com" share one tally rather than giving an attacker two, then hashed
// so the address itself never lands in the keyspace.
func IdentityFailureKey(emailAddress string) string {
	normalized := strings.ToLower(strings.TrimSpace(emailAddress))
	digest := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(digest[:])
}

// AcquireWakeLock reports whether the caller is the one that should wake a
// sleeping service, collapsing a burst of requests into a single outbound
// wake (wake.SingleFlightLock).
//
// It is deliberately a plain SET NX EX and not a released lock: the key is
// meant to stay held for its whole TTL, because the point is to stay quiet
// for roughly one cold start, not to guard a critical section. Nothing here
// is a correctness requirement - a lost lock costs one redundant call.
func (store *RedisStore) AcquireWakeLock(ctx context.Context, service string, timeToLive time.Duration) (bool, error) {
	return store.client.SetNX(ctx, store.key(wakeKeySegment, sanitizeKeyPart(service)), "1", timeToLive).Result()
}

// IncrementWakeCount records that a wake call was actually sent, which is not
// the same number as requests that found a service asleep: single-flight
// collapses a burst into one call, and only the call costs instance-hours.
//
// Counters live in Redis rather than travelling to analytics-service as
// events, and the reason is not volume - it is that reading them must not
// perturb them. analytics-service is itself scale-to-zero, so opening a page
// to view wake statistics would wake it and produce a wake to view. The
// gateway is awake by definition whenever it records one of these, and Redis
// is managed, so this path measures without taking part.
func (store *RedisStore) RecordWakeSent(ctx context.Context, service string, at time.Time) error {
	dailyKey := store.key(wakeCountKeySegment, sanitizeKeyPart(service), at.UTC().Format(wakeStatsDayFormat))
	failuresKey := store.key(wakeFailuresKeySegment, sanitizeKeyPart(service))
	pipeline := store.client.Pipeline()
	pipeline.Incr(ctx, dailyKey)
	pipeline.Expire(ctx, dailyKey, wakeStatsRetention)
	// The same call bumps the consecutive-unanswered tally, because a wake is
	// assumed failed until the service answers. Counting optimistically the
	// other way round would need a second write on the success path, on every
	// request, to undo it.
	pipeline.Incr(ctx, failuresKey)
	pipeline.Expire(ctx, failuresKey, wakeFailureWindow)
	_, err := pipeline.Exec(ctx)
	return err
}

// RecordServiceSeen stamps the last moment a service is known to have been
// awake, which is how a sleep interval is derived without the sleeping
// service having to report anything.
//
// A service cannot reliably announce its own sleep. Render sends SIGTERM
// before spinning an instance down, but that same signal covers deploys and
// manual restarts, and an OOM kill or panic sends nothing at all - so
// self-reported sleep would record every graceful stop and miss every bad
// death, which is exactly backwards. An observation made from outside has no
// such bias: a successful reply proves the service was alive at that instant,
// and the gap between this stamp and the next wake bounds the sleep.
func (store *RedisStore) RecordServiceSeen(ctx context.Context, service string, at time.Time) error {
	pipeline := store.client.Pipeline()
	pipeline.Set(ctx, store.key(wakeSeenKeySegment, sanitizeKeyPart(service)), strconv.FormatInt(at.UTC().Unix(), 10), wakeStatsRetention)
	// Clearing the failure tally rides along in the same round trip rather
	// than costing its own. wakeFailureWindow would expire it anyway; this
	// makes a service that recovers stop being reported as dead within one
	// throttle interval instead of one window.
	pipeline.Del(ctx, store.key(wakeFailuresKeySegment, sanitizeKeyPart(service)))
	_, err := pipeline.Exec(ctx)
	return err
}

// ConsecutiveFailedWakes is how many wake calls have been sent for a service
// without it answering since.
//
// Zero is the answer for a service that is simply asleep: the count only
// starts at the first wake, and a normal cold start answers before a second
// one is due.
func (store *RedisStore) ConsecutiveFailedWakes(ctx context.Context, service string) (int, error) {
	raw, err := store.client.Get(ctx, store.key(wakeFailuresKeySegment, sanitizeKeyPart(service))).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(raw)
}

// WakeStats reads back what the two writers above recorded, for the days
// ending at endDay inclusive.
//
// One MGET, never SCAN or KEYS: the services are a fixed list and the days
// are a fixed range, so every key is computable and a growing keyspace never
// turns this into an O(database) command on a shared Redis.
func (store *RedisStore) WakeStats(ctx context.Context, services []string, endDay time.Time, days int) (map[string]ServiceWakeStats, error) {
	if days < 1 {
		days = 1
	}
	dayStamps := make([]string, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		dayStamps = append(dayStamps, endDay.UTC().AddDate(0, 0, -offset).Format(wakeStatsDayFormat))
	}
	keys := make([]string, 0, len(services)*len(dayStamps)+len(services))
	for _, service := range services {
		for _, dayStamp := range dayStamps {
			keys = append(keys, store.key(wakeCountKeySegment, sanitizeKeyPart(service), dayStamp))
		}
	}
	for _, service := range services {
		keys = append(keys, store.key(wakeSeenKeySegment, sanitizeKeyPart(service)))
	}
	for _, service := range services {
		keys = append(keys, store.key(wakeFailuresKeySegment, sanitizeKeyPart(service)))
	}
	values, err := store.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	stats := make(map[string]ServiceWakeStats, len(services))
	for serviceIndex, service := range services {
		daily := make(map[string]int64, len(dayStamps))
		var total int64
		for dayIndex, dayStamp := range dayStamps {
			count := parseRedisInt(values[serviceIndex*len(dayStamps)+dayIndex])
			daily[dayStamp] = count
			total += count
		}
		serviceStats := ServiceWakeStats{Service: service, TotalWakes: total, DailyWakes: daily}
		if seenUnix := parseRedisInt(values[len(services)*len(dayStamps)+serviceIndex]); seenUnix > 0 {
			lastSeen := time.Unix(seenUnix, 0).UTC()
			serviceStats.LastSeenAt = &lastSeen
		}
		serviceStats.ConsecutiveFailedWakes = int(parseRedisInt(values[len(services)*len(dayStamps)+len(services)+serviceIndex]))
		stats[service] = serviceStats
	}
	return stats, nil
}

// ServiceWakeStats is what one service looked like over the requested window.
// LastSeenAt is a pointer because "never observed awake" and "observed at the
// zero time" have to stay distinguishable - a fresh deploy legitimately has
// no observation yet, and rendering that as 1970 would be a lie.
type ServiceWakeStats struct {
	Service    string           `json:"service"`
	TotalWakes int64            `json:"totalWakes"`
	DailyWakes map[string]int64 `json:"dailyWakes"`
	LastSeenAt *time.Time       `json:"lastSeenAt"`
	// ConsecutiveFailedWakes is the live tally, not history: it counts wakes
	// sent with no reply since, and clears itself once the service answers or
	// once nobody has tried for a while. A non-zero value here is the signal
	// an operator wants - a service the gateway keeps trying to start and
	// cannot.
	ConsecutiveFailedWakes int `json:"consecutiveFailedWakes"`
}

// parseRedisInt treats a missing key and an unparseable one alike, as zero.
// These are counters for a dashboard, not ledger entries: a value this store
// cannot read is a gap in a chart, never a reason to fail the request that
// was trying to display it.
func parseRedisInt(value any) int64 {
	raw, isString := value.(string)
	if !isString {
		return 0
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func (store *RedisStore) Ping(ctx context.Context) error {
	return store.client.Ping(ctx).Err()
}

func (store *RedisStore) Close() error {
	return store.client.Close()
}

func (store *RedisStore) key(parts ...string) string {
	return store.keyPrefix + ":" + strings.Join(parts, ":")
}

func sanitizeKeyPart(value string) string {
	replacer := strings.NewReplacer(":", "_", " ", "_", "\n", "_", "\r", "_")
	return replacer.Replace(value)
}

func RetryAfterSeconds(delay time.Duration) int {
	seconds := int(math.Ceil(delay.Seconds()))
	if seconds < 1 {
		return 1
	}
	return seconds
}

func WorldCacheIdentifier(family, worldID string) string {
	return fmt.Sprintf("%s:%s", family, worldID)
}

func ShareCacheIdentifier(family, shareSlug string) string {
	return fmt.Sprintf("%s:%s", family, shareSlug)
}
