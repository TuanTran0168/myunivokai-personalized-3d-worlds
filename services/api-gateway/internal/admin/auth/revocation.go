package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
)

// TokenVersionCache is the read side of the revocation cache; auth-service is
// the only writer. *edge.RedisStore satisfies this without any change.
type TokenVersionCache interface {
	GetTokenVersion(ctx context.Context, accountID string) (int, error)
	SetTokenVersion(ctx context.Context, accountID string, tokenVersion int, timeToLive time.Duration) error
}

// TokenVersionRequester is the one NATS call this package ever makes: the
// cache-miss fallback. broker.Client already satisfies this.
type TokenVersionRequester interface {
	Request(ctx context.Context, subject string, data any) (contracts.Envelope[contracts.RPCResponseData], error)
}

// RevocationChecker answers whether an access token's tokenVersion claim is
// stale. The common path is one Redis read; only a cache miss calls
// auth-service, and a miss is never read as "not revoked" — see
// notes/vision/auth-and-admin-plan.md#how-b-works.
type RevocationChecker struct {
	cache        TokenVersionCache
	requester    TokenVersionRequester
	queryTimeout time.Duration
	cacheTTL     time.Duration
}

func NewRevocationChecker(cache TokenVersionCache, requester TokenVersionRequester, queryTimeout, cacheTTL time.Duration) RevocationChecker {
	return RevocationChecker{cache: cache, requester: requester, queryTimeout: queryTimeout, cacheTTL: cacheTTL}
}

// IsRevoked reports whether claimedTokenVersion is behind the account's
// current tokenVersion.
func (checker RevocationChecker) IsRevoked(ctx context.Context, accountID string, claimedTokenVersion int) (bool, error) {
	currentTokenVersion, err := checker.cache.GetTokenVersion(ctx, accountID)
	if errors.Is(err, edge.ErrCacheMiss) {
		currentTokenVersion, err = checker.fetchAndCache(ctx, accountID)
	}
	if err != nil {
		return false, err
	}
	return claimedTokenVersion < currentTokenVersion, nil
}

func (checker RevocationChecker) fetchAndCache(ctx context.Context, accountID string) (int, error) {
	requestContext, cancel := context.WithTimeout(ctx, checker.queryTimeout)
	defer cancel()
	requestID := httpx.RequestID(ctx)
	response, err := checker.requester.Request(requestContext, contracts.AuthTokenVersionQuerySubject,
		contracts.NewEnvelope(requestID, contracts.TokenVersionQueryData{AccountID: accountID}))
	if err != nil {
		return 0, err
	}
	if response.Data.Error != nil {
		return 0, errors.New(response.Data.Error.Message)
	}
	var payload contracts.TokenVersionResponseData
	if err := json.Unmarshal(response.Data.Payload, &payload); err != nil {
		return 0, err
	}
	if cacheErr := checker.cache.SetTokenVersion(ctx, accountID, payload.TokenVersion, checker.cacheTTL); cacheErr != nil {
		// The caller already has the answer it needs; a failed cache write
		// only means the next request pays this same fallback again.
		log.Warn().Err(cacheErr).Str("account_id", accountID).Msg("cache admin tokenVersion after fallback fetch")
	}
	return payload.TokenVersion, nil
}
