// Package auth implements the gateway side of the admin access-token
// contract: local Ed25519 signature verification plus the Redis tokenVersion
// revocation check, so an admin request never pays a network hop to
// auth-service on the common path — see
// agent-system/plans/services/auth-and-admin-plan.md#how-b-works.
package auth

import (
	"crypto/ed25519"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var ErrInvalidAccessToken = errors.New("invalid admin access token")

// accessTokenClaims mirrors services/auth-service/internal/security/tokens.go
// exactly: both sides must agree on the wire shape without importing one
// another (auth-service and the gateway are separate Go modules).
type accessTokenClaims struct {
	Roles        []string                  `json:"roles"`
	Audience     contracts.AccountAudience `json:"audience"`
	TokenVersion int                       `json:"tokenVersion"`
	jwt.RegisteredClaims
}

// TokenVerifier checks the Ed25519 signature and expiry of an admin access
// token locally. It holds every currently-accepted public key so a key
// rotation can add the new one before the old is removed and no session is
// force-logged-out — see agent-system/plans/services/auth-and-admin-plan.md#tokens.
type TokenVerifier struct {
	publicKeys []ed25519.PublicKey
}

func NewTokenVerifier(publicKeys []ed25519.PublicKey) TokenVerifier {
	return TokenVerifier{publicKeys: publicKeys}
}

func (verifier TokenVerifier) Verify(tokenString string) (contracts.AccessTokenClaims, error) {
	for _, publicKey := range verifier.publicKeys {
		claims, err := verifyWithKey(tokenString, publicKey)
		if err == nil {
			return claims, nil
		}
	}
	return contracts.AccessTokenClaims{}, ErrInvalidAccessToken
}

func verifyWithKey(tokenString string, publicKey ed25519.PublicKey) (contracts.AccessTokenClaims, error) {
	var claims accessTokenClaims
	_, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, ErrInvalidAccessToken
		}
		return publicKey, nil
	})
	if err != nil {
		return contracts.AccessTokenClaims{}, ErrInvalidAccessToken
	}
	if claims.Subject == "" {
		return contracts.AccessTokenClaims{}, ErrInvalidAccessToken
	}
	var expiresAt time.Time
	if claims.ExpiresAt != nil {
		expiresAt = claims.ExpiresAt.Time
	}
	return contracts.AccessTokenClaims{
		Subject:      claims.Subject,
		Roles:        claims.Roles,
		Audience:     claims.Audience,
		TokenVersion: claims.TokenVersion,
		ExpiresAt:    expiresAt,
	}, nil
}
