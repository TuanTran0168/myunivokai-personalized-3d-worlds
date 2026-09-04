package redis

import (
	"context"
	"strconv"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/redis/go-redis/v9"
)

// noExpiry is go-redis' spelling of "this key does not expire". Named, because
// a bare 0 at a call site reads as a mistake next to every other Set in this
// repository that passes a real TTL.
const noExpiry = time.Duration(0)

// The two key conventions this service writes and the gateway reads. Both
// match the gateway's own segment constants — <REDIS_KEY_PREFIX>:auth:tokenversion:<accountId>
// and <REDIS_KEY_PREFIX>:setting:<key> — so the two processes agree on a key
// without either hardcoding the other's prefix.
const (
	tokenVersionKeySegment = "auth:tokenversion"

	// settingKeySegment is singular because the key names ONE setting. It is
	// also why a setting key may not contain a colon
	// (contracts.settingKeyPattern refuses one): the colon is this keyspace's
	// separator, and a key carrying one would address a different entry than
	// the one it names.
	settingKeySegment = "setting"
)

// Client is the write side of the revocation cache: auth-service is the only
// writer, on every tokenVersion bump. The gateway is a reader with a
// cache-miss fallback that calls auth-service directly — see
// agent-system/plans/services/auth-and-admin-plan.md#how-b-works.
type Client struct {
	client    *redis.Client
	keyPrefix string
}

func NewClient(redisURL, keyPrefix string) (*Client, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &Client{client: redis.NewClient(options), keyPrefix: strings.TrimSuffix(keyPrefix, ":")}, nil
}

func (client *Client) SetTokenVersion(ctx context.Context, accountID string, tokenVersion int, timeToLive time.Duration) error {
	return client.client.Set(ctx, client.tokenVersionKey(accountID), strconv.Itoa(tokenVersion), timeToLive).Err()
}

// SetSetting mirrors one setting into Redis for the gateway to read WITHOUT
// asking this service anything. auth-service is the only writer.
//
// No TTL, deliberately, unlike SetTokenVersion. A tokenVersion entry may
// expire because the gateway's cache miss falls back to a NATS request and
// re-caches; a setting entry may not, because §9.3 forbids that fallback on the
// create path — an expired setting entry would silently become the compiled-in
// default while a row said otherwise. What covers a FLUSHED Redis is
// re-mirroring every setting at startup, not an expiry.
func (client *Client) SetSetting(ctx context.Context, key contracts.SettingKey, value string) error {
	return client.client.Set(ctx, client.settingKey(key), value, noExpiry).Err()
}

func (client *Client) Ping(ctx context.Context) error {
	return client.client.Ping(ctx).Err()
}

func (client *Client) Close() error {
	return client.client.Close()
}

func (client *Client) tokenVersionKey(accountID string) string {
	return client.keyPrefix + ":" + tokenVersionKeySegment + ":" + accountID
}

func (client *Client) settingKey(key contracts.SettingKey) string {
	return client.keyPrefix + ":" + settingKeySegment + ":" + string(key)
}
