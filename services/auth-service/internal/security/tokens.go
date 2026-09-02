package security

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const refreshTokenByteLength = 32

var ErrInvalidAccessToken = errors.New("invalid access token")

type accessTokenClaims struct {
	Roles        []string                  `json:"roles"`
	Audience     contracts.AccountAudience `json:"audience"`
	TokenVersion int                       `json:"tokenVersion"`
	jwt.RegisteredClaims
}

// TokenIssuer mints and verifies the short-lived Ed25519 access JWT. Every
// edge verifies locally with the public key, so no network hop is required
// per request, and login still works when auth-service is cold - see
// agent-system/plans/services/auth-and-admin-plan.md#tokens.
//
// It holds one access lifetime per audience because the two are genuinely
// different policies rather than one tunable: staff keep 10 minutes, and the
// product audience gets 7 days (plan §4.4). Choosing the lifetime here, from
// the audience already being stamped into the claims, keeps the pair with the
// code that mints the token instead of asking every caller to remember which
// number belongs to which audience.
type TokenIssuer struct {
	privateKey     ed25519.PrivateKey
	publicKey      ed25519.PublicKey
	adminAccessTTL time.Duration
	webAccessTTL   time.Duration
}

func NewTokenIssuer(privateKey ed25519.PrivateKey, adminAccessTTL, webAccessTTL time.Duration) TokenIssuer {
	return TokenIssuer{
		privateKey:     privateKey,
		publicKey:      privateKey.Public().(ed25519.PublicKey),
		adminAccessTTL: adminAccessTTL,
		webAccessTTL:   webAccessTTL,
	}
}

// accessTokenTTL falls back to the ADMIN lifetime for an audience it does not
// recognise, which is the shorter of the two and therefore the safe default: an
// audience value this code has never seen produces a token that expires soon
// rather than one that lives for a week.
func (issuer TokenIssuer) accessTokenTTL(audience contracts.AccountAudience) time.Duration {
	if audience == contracts.AccountAudienceWeb {
		return issuer.webAccessTTL
	}
	return issuer.adminAccessTTL
}

func (issuer TokenIssuer) IssueAccessToken(accountID string, roles []string, audience contracts.AccountAudience, tokenVersion int) (string, time.Time, error) {
	issuedAt := time.Now().UTC()
	expiresAt := issuedAt.Add(issuer.accessTokenTTL(audience))
	claims := accessTokenClaims{
		Roles:        roles,
		Audience:     audience,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   accountID,
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	signed, err := token.SignedString(issuer.privateKey)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

func (issuer TokenIssuer) VerifyAccessToken(tokenString string) (contracts.AccessTokenClaims, error) {
	var claims accessTokenClaims
	_, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, ErrInvalidAccessToken
		}
		return issuer.publicKey, nil
	})
	if err != nil {
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

// GenerateRefreshToken returns the raw token (sent to the caller once) and
// its SHA-256 hash (the only form ever stored). SHA-256, not Argon2id: this
// is a 256-bit random value rather than a user-chosen password, so slow
// verification buys no meaningful brute-force resistance and only costs
// latency on every refresh.
func GenerateRefreshToken() (raw, hash string, err error) {
	buffer := make([]byte, refreshTokenByteLength)
	if _, err = rand.Read(buffer); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(buffer)
	return raw, HashRefreshToken(raw), nil
}

func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
