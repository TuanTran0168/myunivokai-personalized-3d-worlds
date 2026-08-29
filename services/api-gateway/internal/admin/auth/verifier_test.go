package auth

import (
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func issueTestToken(t *testing.T, privateKey ed25519.PrivateKey, subject string, tokenVersion int, expiresAt time.Time) string {
	t.Helper()
	claims := accessTokenClaims{
		Roles:        []string{"basic_user"},
		Audience:     contracts.AccountAudienceAdmin,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(privateKey)
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}
	return signed
}

func TestVerifyAcceptsATokenSignedByAKnownKey(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewTokenVerifier([]ed25519.PublicKey{publicKey})
	token := issueTestToken(t, privateKey, "account-1", 3, time.Now().Add(time.Minute))
	claims, err := verifier.Verify(token)
	if err != nil {
		t.Fatalf("expected a valid token to verify: %v", err)
	}
	if claims.Subject != "account-1" || claims.TokenVersion != 3 || claims.Audience != contracts.AccountAudienceAdmin {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestVerifyRejectsATokenSignedByAnUnknownKey(t *testing.T) {
	_, otherPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	acceptedPublicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewTokenVerifier([]ed25519.PublicKey{acceptedPublicKey})
	token := issueTestToken(t, otherPrivateKey, "account-1", 1, time.Now().Add(time.Minute))
	if _, err := verifier.Verify(token); err == nil {
		t.Fatal("expected a token signed by an untrusted key to be rejected")
	}
}

func TestVerifyRejectsAnExpiredToken(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewTokenVerifier([]ed25519.PublicKey{publicKey})
	token := issueTestToken(t, privateKey, "account-1", 1, time.Now().Add(-time.Minute))
	if _, err := verifier.Verify(token); err == nil {
		t.Fatal("expected an expired token to be rejected")
	}
}

// A rotation adds the new public key before removing the old one so no
// session is force-logged-out - see agent-system/plans/services/auth-and-admin-plan.md#tokens.
func TestVerifyAcceptsEitherKeyDuringRotation(t *testing.T) {
	oldPublicKey, oldPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	newPublicKey, newPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewTokenVerifier([]ed25519.PublicKey{newPublicKey, oldPublicKey})
	oldToken := issueTestToken(t, oldPrivateKey, "account-1", 1, time.Now().Add(time.Minute))
	newToken := issueTestToken(t, newPrivateKey, "account-1", 1, time.Now().Add(time.Minute))
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("expected the still-valid old key to verify: %v", err)
	}
	if _, err := verifier.Verify(newToken); err != nil {
		t.Fatalf("expected the new key to verify: %v", err)
	}
}
