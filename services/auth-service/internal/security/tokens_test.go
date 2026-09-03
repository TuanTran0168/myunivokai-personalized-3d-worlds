package security

import (
	"crypto/ed25519"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// testAccessTokenLifetime is now a plain argument rather than a property of
// the issuer. The per-audience choice these tests used to exercise here moved
// to AuthService.accessTokenLifetime when both lifetimes became settings, and
// TestSessionLifetimesComeFromTheAudiencesOwnSettings in internal/services is
// where it is asserted now — against the audience, which is what decides it.
const testAccessTokenLifetime = 10 * time.Minute

func TestTokenIssuer_IssueAndVerifyAccessToken_RoundTrips(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	issuer := NewTokenIssuer(privateKey)
	signed, expiresAt, err := issuer.IssueAccessToken("account-1", []string{"basic_user"}, contracts.AccountAudienceAdmin, 3, testAccessTokenLifetime)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := issuer.VerifyAccessToken(signed)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "account-1" {
		t.Fatalf("expected subject account-1, got %q", claims.Subject)
	}
	if claims.Audience != contracts.AccountAudienceAdmin {
		t.Fatalf("expected admin audience, got %q", claims.Audience)
	}
	if claims.TokenVersion != 3 {
		t.Fatalf("expected token version 3, got %d", claims.TokenVersion)
	}
	// JWT numeric dates round-trip at whole-second precision (RFC 7519 §2),
	// so compare at that precision rather than exact nanosecond equality.
	if claims.ExpiresAt.Unix() != expiresAt.Unix() {
		t.Fatalf("expected expiry %v, got %v", expiresAt, claims.ExpiresAt)
	}
}

func TestTokenIssuer_VerifyAccessToken_RejectsWrongSigningKey(t *testing.T) {
	_, privateKeyA, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	_, privateKeyB, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	issuedByA := NewTokenIssuer(privateKeyA)
	verifiedByB := NewTokenIssuer(privateKeyB)
	signed, _, err := issuedByA.IssueAccessToken("account-1", nil, contracts.AccountAudienceAdmin, 1, testAccessTokenLifetime)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := verifiedByB.VerifyAccessToken(signed); err != ErrInvalidAccessToken {
		t.Fatalf("expected ErrInvalidAccessToken across different keys, got %v", err)
	}
}

func TestTokenIssuer_VerifyAccessToken_RejectsExpiredToken(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	issuer := NewTokenIssuer(privateKey)
	// Already expired at mint time. A negative lifetime is not a value any
	// setting will produce — auth.token.admin.access_ttl declares a floor of
	// one minute — but IssueAccessToken takes what it is given, and this is
	// the only way to get an expired token without waiting for one.
	signed, _, err := issuer.IssueAccessToken("account-1", nil, contracts.AccountAudienceAdmin, 1, -time.Minute)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := issuer.VerifyAccessToken(signed); err != ErrInvalidAccessToken {
		t.Fatalf("expected ErrInvalidAccessToken for an expired token, got %v", err)
	}
}

func TestGenerateRefreshToken_HashIsStableAndDistinctPerToken(t *testing.T) {
	rawA, hashA, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	rawB, hashB, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if rawA == rawB || hashA == hashB {
		t.Fatal("expected two generated refresh tokens to differ")
	}
	if HashRefreshToken(rawA) != hashA {
		t.Fatal("expected hashing the same raw token twice to be stable")
	}
}
