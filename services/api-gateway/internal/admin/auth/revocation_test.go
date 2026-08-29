package auth

import (
	"context"
	"net/http"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

type fakeTokenVersionCache struct {
	values   map[string]int
	setCalls int
}

func newFakeTokenVersionCache() *fakeTokenVersionCache {
	return &fakeTokenVersionCache{values: make(map[string]int)}
}

func (cache *fakeTokenVersionCache) GetTokenVersion(_ context.Context, accountID string) (int, error) {
	value, found := cache.values[accountID]
	if !found {
		return 0, edge.ErrCacheMiss
	}
	return value, nil
}

func (cache *fakeTokenVersionCache) SetTokenVersion(_ context.Context, accountID string, tokenVersion int, _ time.Duration) error {
	cache.setCalls++
	cache.values[accountID] = tokenVersion
	return nil
}

type fakeTokenVersionRequester struct {
	calls        int
	tokenVersion int
}

func (requester *fakeTokenVersionRequester) Request(_ context.Context, _ string, _ any) (contracts.Envelope[contracts.RPCResponseData], error) {
	requester.calls++
	return contracts.SuccessRPCEnvelope("request-1", http.StatusOK, contracts.TokenVersionResponseData{TokenVersion: requester.tokenVersion})
}

func TestIsRevokedReadsTheCacheWithoutCallingAuthServiceOnAHit(t *testing.T) {
	cache := newFakeTokenVersionCache()
	cache.values["account-1"] = 5
	requester := &fakeTokenVersionRequester{}
	checker := NewRevocationChecker(cache, requester, time.Second, time.Minute)

	revoked, err := checker.IsRevoked(context.Background(), "account-1", 5)
	if err != nil {
		t.Fatal(err)
	}
	if revoked {
		t.Fatal("a claim equal to the current version must not be revoked")
	}
	if requester.calls != 0 {
		t.Fatalf("expected no auth-service call on a cache hit, got %d", requester.calls)
	}
}

func TestIsRevokedDetectsAStaleClaimFromTheCache(t *testing.T) {
	cache := newFakeTokenVersionCache()
	cache.values["account-1"] = 7
	checker := NewRevocationChecker(cache, &fakeTokenVersionRequester{}, time.Second, time.Minute)

	revoked, err := checker.IsRevoked(context.Background(), "account-1", 3)
	if err != nil {
		t.Fatal(err)
	}
	if !revoked {
		t.Fatal("a claim behind the cached version must be revoked")
	}
}

// A cache miss must call auth-service exactly once and repopulate the cache,
// never be read as "not revoked" - see
// notes/plans/services/auth-and-admin-plan.md#how-b-works.
func TestIsRevokedFallsBackToAuthServiceExactlyOnceOnACacheMiss(t *testing.T) {
	cache := newFakeTokenVersionCache()
	requester := &fakeTokenVersionRequester{tokenVersion: 9}
	checker := NewRevocationChecker(cache, requester, time.Second, time.Minute)

	revoked, err := checker.IsRevoked(context.Background(), "account-1", 4)
	if err != nil {
		t.Fatal(err)
	}
	if !revoked {
		t.Fatal("claim 4 behind fetched version 9 must be revoked")
	}
	if requester.calls != 1 {
		t.Fatalf("expected exactly one auth-service call on a cache miss, got %d", requester.calls)
	}
	if cache.setCalls != 1 || cache.values["account-1"] != 9 {
		t.Fatalf("expected the fetched version to be cached, got %+v (set calls=%d)", cache.values, cache.setCalls)
	}
}
