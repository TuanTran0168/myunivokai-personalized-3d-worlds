package redis

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// tokenVersionKeySegment matches the gateway's key convention
// (<REDIS_KEY_PREFIX>:auth:tokenversion:<accountId>) so both processes agree
// on the same key without either hardcoding the other's prefix.
const tokenVersionKeySegment = "auth:tokenversion"

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

func (client *Client) Ping(ctx context.Context) error {
	return client.client.Ping(ctx).Err()
}

func (client *Client) Close() error {
	return client.client.Close()
}

func (client *Client) tokenVersionKey(accountID string) string {
	return client.keyPrefix + ":" + tokenVersionKeySegment + ":" + accountID
}
