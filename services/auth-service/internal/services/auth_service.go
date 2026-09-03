package services

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
	"github.com/rs/zerolog/log"
)

// TokenVersionCache is the write side of the gateway's revocation check.
// *redis.Client satisfies this without any change; tests inject a fake so
// the business logic runs with no network dependency.
type TokenVersionCache interface {
	SetTokenVersion(ctx context.Context, accountID string, tokenVersion int, timeToLive time.Duration) error
}

var (
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrAccountDisabled     = errors.New("account disabled")
	ErrAccountLocked       = errors.New("account locked")
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrLastSuperAdmin      = errors.New("cannot disable the last super admin account")
)

const (
	auditActionLogin          = "login"
	auditActionRefresh        = "refresh"
	auditActionLogout         = "logout"
	auditActionAccountDisable = "account_disable"
	auditActionAccountEnable  = "account_enable"
	// auditActionRegister is the whole of the registration metric: the plan's
	// section 14.2 measures signups by counting these rows rather than by
	// adding a projection to analytics-service, because an audit row is
	// written on the only path that can create an end-user account and
	// therefore cannot drift from it.
	auditActionRegister      = "register"
	auditResultSuccess       = "success"
	auditResultInvalidCreds  = "invalid_credentials"
	auditResultDisabled      = "account_disabled"
	auditResultLocked        = "account_locked"
	auditResultReuseDetected = "refresh_reuse_detected"
	// auditResultAudienceMismatch records a credential presented at the wrong
	// audience's door - a staff address at the product login, or an end-user
	// address at the admin login. The RESPONSE for this case is identical to a
	// wrong password (see login), so this row is the only place the
	// distinction survives, and staff want it: it separates "somebody is
	// guessing passwords" from "somebody is looking for the admin app".
	auditResultAudienceMismatch = "audience_mismatch"
)

// AuthService holds every rule the plan assigns to auth-service itself:
// Argon2id verification at constant time regardless of account existence,
// lockout, refresh rotation with reuse detection, and the Redis tokenVersion
// cache the gateway's revocation check depends on.
type AuthService struct {
	store             repositories.Store
	passwordHasher    security.PasswordHasher
	tokenIssuer       security.TokenIssuer
	tokenVersionCache TokenVersionCache
	passwordPolicy    PasswordPolicy
	cfg               config.Config
	dummyPasswordHash string
}

func NewAuthService(store repositories.Store, passwordHasher security.PasswordHasher, tokenIssuer security.TokenIssuer, tokenVersionCache TokenVersionCache, passwordPolicy PasswordPolicy, cfg config.Config) (*AuthService, error) {
	dummyHash, err := passwordHasher.Hash("myunivokai-constant-time-decoy")
	if err != nil {
		return nil, err
	}
	return &AuthService{
		store: store, passwordHasher: passwordHasher, tokenIssuer: tokenIssuer, tokenVersionCache: tokenVersionCache,
		passwordPolicy: passwordPolicy, cfg: cfg, dummyPasswordHash: dummyHash,
	}, nil
}

// Login verifies a STAFF credential pair with a constant-time response
// whether or not the account exists: an unknown email still pays the full
// Argon2id cost against a fixed decoy hash before returning the same error -
// see agent-system/plans/services/auth-and-admin-plan.md#passwords.
func (service *AuthService) Login(ctx context.Context, data contracts.LoginData, sourceAddress string) (contracts.LoginResponseData, error) {
	return service.login(ctx, data, sourceAddress, contracts.AccountKindStaff)
}

// LoginEndUser is the product flow's login. It is the same verification,
// lockout and audit path as the staff one - reused rather than copied, which
// is the whole reason decision 1 extended auth-service instead of building a
// second identity service - differing only in the kind of account it accepts.
func (service *AuthService) LoginEndUser(ctx context.Context, data contracts.LoginData, sourceAddress string) (contracts.LoginResponseData, error) {
	return service.login(ctx, data, sourceAddress, contracts.AccountKindEndUser)
}

func (service *AuthService) login(ctx context.Context, data contracts.LoginData, sourceAddress string, requiredKind contracts.AccountKind) (contracts.LoginResponseData, error) {
	email := normalizeEmail(data.Email)
	account, err := service.store.GetAccountByEmail(ctx, email)
	if errors.Is(err, repositories.ErrNotFound) {
		_ = service.passwordHasher.Verify(data.Password, service.dummyPasswordHash)
		service.audit(ctx, nil, auditActionLogin, email, auditResultInvalidCreds, sourceAddress)
		return contracts.LoginResponseData{}, ErrInvalidCredentials
	}
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	// An account of the other kind is answered exactly as a missing one: the
	// same decoy hash for the same Argon2id cost, and the same error. Skipping
	// the decoy here would leak the distinction through response time, and
	// returning a different error would leak it outright - either would let
	// the product login enumerate which addresses belong to staff.
	if account.Kind != requiredKind {
		_ = service.passwordHasher.Verify(data.Password, service.dummyPasswordHash)
		service.audit(ctx, &account.ID, auditActionLogin, email, auditResultAudienceMismatch, sourceAddress)
		return contracts.LoginResponseData{}, ErrInvalidCredentials
	}
	if account.Disabled {
		service.audit(ctx, &account.ID, auditActionLogin, email, auditResultDisabled, sourceAddress)
		return contracts.LoginResponseData{}, ErrAccountDisabled
	}
	if account.LockedUntil != nil && account.LockedUntil.After(time.Now().UTC()) {
		service.audit(ctx, &account.ID, auditActionLogin, email, auditResultLocked, sourceAddress)
		return contracts.LoginResponseData{}, ErrAccountLocked
	}
	if err := service.passwordHasher.Verify(data.Password, account.PasswordHash); err != nil {
		if recordErr := service.store.RecordFailedLoginAttempt(ctx, account.ID, service.cfg.MaximumFailedAttempts, service.cfg.LockoutDuration); recordErr != nil {
			log.Error().Err(recordErr).Str("account_id", account.ID).Msg("record failed login attempt")
		}
		service.audit(ctx, &account.ID, auditActionLogin, email, auditResultInvalidCreds, sourceAddress)
		return contracts.LoginResponseData{}, ErrInvalidCredentials
	}
	if err := service.store.ResetFailedLoginAttempts(ctx, account.ID); err != nil {
		return contracts.LoginResponseData{}, err
	}
	response, err := service.issueSession(ctx, account, uuid.NewString())
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	service.audit(ctx, &account.ID, auditActionLogin, email, auditResultSuccess, sourceAddress)
	return response, nil
}

// Refresh rotates the presented token and detects reuse: a token whose
// used_at is already set means the previous response was intercepted, so the
// whole family is revoked rather than only the reused row - see
// agent-system/plans/services/auth-and-admin-plan.md#tokens.
func (service *AuthService) Refresh(ctx context.Context, rawRefreshToken, sourceAddress string) (contracts.LoginResponseData, error) {
	return service.refresh(ctx, rawRefreshToken, sourceAddress, contracts.AccountKindStaff)
}

// RefreshEndUserSession rotates a product session. It shares every rule with
// the staff path - single use, family-wide reuse detection, disabled-account
// rejection - and adds only the kind check, so a refresh token cannot be
// carried from one audience's door to the other.
func (service *AuthService) RefreshEndUserSession(ctx context.Context, rawRefreshToken, sourceAddress string) (contracts.LoginResponseData, error) {
	return service.refresh(ctx, rawRefreshToken, sourceAddress, contracts.AccountKindEndUser)
}

func (service *AuthService) refresh(ctx context.Context, rawRefreshToken, sourceAddress string, requiredKind contracts.AccountKind) (contracts.LoginResponseData, error) {
	tokenHash := security.HashRefreshToken(rawRefreshToken)
	existingToken, err := service.store.GetRefreshTokenByHash(ctx, tokenHash)
	if errors.Is(err, repositories.ErrNotFound) {
		return contracts.LoginResponseData{}, ErrInvalidRefreshToken
	}
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	if existingToken.RevokedAt != nil || existingToken.ExpiresAt.Before(time.Now().UTC()) {
		return contracts.LoginResponseData{}, ErrInvalidRefreshToken
	}
	if existingToken.UsedAt != nil {
		if revokeErr := service.store.RevokeRefreshTokenFamily(ctx, existingToken.FamilyID); revokeErr != nil {
			log.Error().Err(revokeErr).Str("family_id", existingToken.FamilyID).Msg("revoke reused refresh token family")
		}
		service.audit(ctx, &existingToken.AccountID, auditActionRefresh, existingToken.AccountID, auditResultReuseDetected, sourceAddress)
		return contracts.LoginResponseData{}, ErrInvalidRefreshToken
	}
	account, err := service.store.GetAccountByID(ctx, existingToken.AccountID)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	if account.Disabled {
		return contracts.LoginResponseData{}, ErrAccountDisabled
	}
	// Checked BEFORE the token is marked used, deliberately. A valid token
	// presented at the wrong audience's refresh path is a client bug, not an
	// attack on the token: consuming it would log the real session out of the
	// real app as a side effect of a request that was never going to succeed.
	if account.Kind != requiredKind {
		return contracts.LoginResponseData{}, ErrInvalidRefreshToken
	}
	if err := service.store.MarkRefreshTokenUsed(ctx, existingToken.ID); err != nil {
		return contracts.LoginResponseData{}, err
	}
	response, err := service.issueSession(ctx, account, existingToken.FamilyID)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	service.audit(ctx, &account.ID, auditActionRefresh, account.ID, auditResultSuccess, sourceAddress)
	return response, nil
}

// Logout revokes the presented token's whole rotation family. An
// already-invalid token is treated as a no-op rather than an error: the
// caller's goal (no longer being logged in) is already true.
func (service *AuthService) Logout(ctx context.Context, rawRefreshToken, sourceAddress string) error {
	tokenHash := security.HashRefreshToken(rawRefreshToken)
	existingToken, err := service.store.GetRefreshTokenByHash(ctx, tokenHash)
	if errors.Is(err, repositories.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := service.store.RevokeRefreshTokenFamily(ctx, existingToken.FamilyID); err != nil {
		return err
	}
	service.audit(ctx, &existingToken.AccountID, auditActionLogout, existingToken.AccountID, auditResultSuccess, sourceAddress)
	return nil
}

// TokenVersion answers the gateway's cache-miss fallback query. A cache miss
// must never be read as "not revoked" by the caller; this method only
// reports the current value - see agent-system/plans/services/auth-and-admin-plan.md#how-b-works.
func (service *AuthService) TokenVersion(ctx context.Context, accountID string) (int, error) {
	account, err := service.store.GetAccountByID(ctx, accountID)
	if err != nil {
		return 0, err
	}
	return account.TokenVersion, nil
}

// DisableAccount bumps tokenVersion, caches it in Redis and revokes every
// refresh token family the account holds, so the disable takes effect within
// the Redis-cached revocation window rather than only at the account's next
// full token expiry - see agent-system/plans/services/auth-and-admin-plan.md#revocation.
//
// The last account with is_super_admin cannot be disabled: that flag is the
// one bypass path back into an otherwise-unadministerable system, and
// disabling its last holder is the same bricking failure the plan's lockout
// guards exist to prevent even though this account's roles are untouched -
// see agent-system/plans/services/auth-and-admin-plan.md#lockout-guards--enforced-server-side-not-in-the-ui.
func (service *AuthService) DisableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error {
	target, err := service.store.GetAccountByID(ctx, accountID)
	if err != nil {
		return err
	}
	if target.IsSuperAdmin && !target.Disabled {
		superAdminCount, err := service.store.CountSuperAdmins(ctx)
		if err != nil {
			return err
		}
		if superAdminCount <= 1 {
			return ErrLastSuperAdmin
		}
	}
	if err := service.store.SetAccountDisabled(ctx, accountID, true); err != nil {
		return err
	}
	if err := service.store.RevokeAllRefreshTokensForAccount(ctx, accountID); err != nil {
		return err
	}
	if err := service.bumpAndCacheTokenVersion(ctx, accountID); err != nil {
		return err
	}
	service.audit(ctx, &actorAccountID, auditActionAccountDisable, accountID, auditResultSuccess, sourceAddress)
	return nil
}

func (service *AuthService) EnableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error {
	if err := service.store.SetAccountDisabled(ctx, accountID, false); err != nil {
		return err
	}
	service.audit(ctx, &actorAccountID, auditActionAccountEnable, accountID, auditResultSuccess, sourceAddress)
	return nil
}

func (service *AuthService) issueSession(ctx context.Context, account repositories.Account, familyID string) (contracts.LoginResponseData, error) {
	roles, permissions, err := service.store.AccountRolesAndPermissions(ctx, account.ID)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	// The audience is read off the account, never chosen by the caller - see
	// contracts.AudienceForAccountKind for why that is the structural half of
	// decision 1's separation. Every session in the platform is minted here,
	// so this one line is the whole of the rule.
	audience := contracts.AudienceForAccountKind(account.Kind)
	accessToken, accessExpiresAt, err := service.tokenIssuer.IssueAccessToken(account.ID, roles, audience, account.TokenVersion)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	rawRefreshToken, refreshTokenHash, err := security.GenerateRefreshToken()
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	refreshExpiresAt := time.Now().UTC().Add(service.refreshTokenLifetime(audience))
	if err := service.store.CreateRefreshToken(ctx, repositories.RefreshToken{
		ID: uuid.NewString(), AccountID: account.ID, FamilyID: familyID, TokenHash: refreshTokenHash, ExpiresAt: refreshExpiresAt,
	}); err != nil {
		return contracts.LoginResponseData{}, err
	}
	return contracts.LoginResponseData{
		AccessToken:      accessToken,
		AccessExpiresAt:  accessExpiresAt,
		RefreshToken:     rawRefreshToken,
		RefreshExpiresAt: refreshExpiresAt,
		Account:          toAccountSummary(account, roles, permissions),
	}, nil
}

// refreshTokenLifetime is the other half of TokenIssuer.accessTokenTTL: the
// audience decides both ends of a session, so neither is a caller's choice.
//
// The two values come from different places on purpose. The admin lifetime is
// a Config field because it is already a deployed environment variable; the
// web one is a Go constant because S8-IDENTITY-012 turns it into a
// system_settings row, and a value that starts life as a setting must not
// arrive as an env var first (see config.WebRefreshTokenTTL).
func (service *AuthService) refreshTokenLifetime(audience contracts.AccountAudience) time.Duration {
	if audience == contracts.AccountAudienceWeb {
		return config.WebRefreshTokenTTL
	}
	return service.cfg.RefreshTokenTTL
}

func (service *AuthService) bumpAndCacheTokenVersion(ctx context.Context, accountID string) error {
	newVersion, err := service.store.BumpTokenVersion(ctx, accountID)
	if err != nil {
		return err
	}
	if err := service.tokenVersionCache.SetTokenVersion(ctx, accountID, newVersion, service.cfg.TokenVersionCacheTTL); err != nil {
		// The gateway's cache-miss fallback calls auth-service directly, so a
		// failed cache write degrades to a slower read rather than a security
		// gap - but it is still logged because it should not happen.
		log.Error().Err(err).Str("account_id", accountID).Msg("cache bumped token version")
	}
	return nil
}

func (service *AuthService) audit(ctx context.Context, actorAccountID *string, action, target, result, sourceAddress string) {
	if err := service.store.RecordAuditEvent(ctx, repositories.AuditEvent{
		ActorAccountID: actorAccountID, Action: action, Target: target, Result: result, SourceAddress: sourceAddress,
	}); err != nil {
		log.Error().Err(err).Str("action", action).Msg("record audit event")
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
