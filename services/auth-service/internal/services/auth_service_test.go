package services

import (
	"context"
	"crypto/ed25519"
	"errors"
	"sync"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
)

// fakeTokenVersionCache stands in for Redis so the business logic under test
// has no network dependency, exactly why AuthService depends on the
// TokenVersionCache interface rather than the concrete Redis client.
type fakeTokenVersionCache struct {
	mu       sync.Mutex
	versions map[string]int
}

func newFakeTokenVersionCache() *fakeTokenVersionCache {
	return &fakeTokenVersionCache{versions: map[string]int{}}
}

func (cache *fakeTokenVersionCache) SetTokenVersion(_ context.Context, accountID string, tokenVersion int, _ time.Duration) error {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	cache.versions[accountID] = tokenVersion
	return nil
}

func testConfig() config.Config {
	_, privateKey, _ := ed25519.GenerateKey(nil)
	return config.Config{
		AccessTokenPrivateKey: privateKey,
		AccessTokenTTL:        10 * time.Minute,
		RefreshTokenTTL:       14 * 24 * time.Hour,
		TokenVersionCacheTTL:  15 * 24 * time.Hour,
		MaximumFailedAttempts: 3,
		LockoutDuration:       15 * time.Minute,
		InviteTokenTTL:        time.Hour,
	}
}

func newTestAuthService(t *testing.T) (*AuthService, *repositories.MemoryStore, *fakeTokenVersionCache) {
	t.Helper()
	store := repositories.NewMemoryStore()
	cfg := testConfig()
	passwordHasher := security.NewPasswordHasher(64*1024, 1, 1, 16, 32)
	tokenIssuer := security.NewTokenIssuer(cfg.AccessTokenPrivateKey, cfg.AccessTokenTTL)
	cache := newFakeTokenVersionCache()
	authService, err := NewAuthService(store, passwordHasher, tokenIssuer, cache, cfg)
	if err != nil {
		t.Fatalf("construct auth service: %v", err)
	}
	return authService, store, cache
}

func createTestAccount(t *testing.T, authService *AuthService, store *repositories.MemoryStore, email, password string) repositories.Account {
	t.Helper()
	hasher := security.NewPasswordHasher(64*1024, 1, 1, 16, 32)
	passwordHash, err := hasher.Hash(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	account, err := store.CreateAccount(context.Background(), repositories.CreateAccountParams{
		Email: email, PasswordHash: passwordHash, Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	_ = authService
	return account
}

func createSuperAdminAccount(t *testing.T, store *repositories.MemoryStore, email, password string) repositories.Account {
	t.Helper()
	hasher := security.NewPasswordHasher(64*1024, 1, 1, 16, 32)
	passwordHash, err := hasher.Hash(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	account, err := store.CreateAccount(context.Background(), repositories.CreateAccountParams{
		Email: email, PasswordHash: passwordHash, Kind: contracts.AccountKindStaff, IsSuperAdmin: true,
	})
	if err != nil {
		t.Fatalf("create super admin account: %v", err)
	}
	return account
}

func TestAuthService_Login_Success(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")

	response, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if err != nil {
		t.Fatalf("expected successful login, got %v", err)
	}
	if response.AccessToken == "" || response.RefreshToken == "" {
		t.Fatal("expected both an access and a refresh token")
	}
	if response.Account.Email != "owner@myunivokai.dev" {
		t.Fatalf("expected account summary email to match, got %q", response.Account.Email)
	}
}

func TestAuthService_Login_UnknownEmailAndWrongPassword_ReturnTheSameError(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")

	_, unknownEmailErr := authService.Login(context.Background(), contracts.LoginData{
		Email: "nobody@myunivokai.dev", Password: "irrelevant",
	}, "203.0.113.1")
	_, wrongPasswordErr := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "wrong-password",
	}, "203.0.113.1")

	if !errors.Is(unknownEmailErr, ErrInvalidCredentials) || !errors.Is(wrongPasswordErr, ErrInvalidCredentials) {
		t.Fatalf("expected both branches to return ErrInvalidCredentials, got %v and %v", unknownEmailErr, wrongPasswordErr)
	}
}

func TestAuthService_Login_LocksAfterConfiguredFailedAttempts(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")

	for attempt := 0; attempt < 3; attempt++ {
		if _, err := authService.Login(context.Background(), contracts.LoginData{
			Email: "owner@myunivokai.dev", Password: "wrong-password",
		}, "203.0.113.1"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: expected ErrInvalidCredentials, got %v", attempt, err)
		}
	}

	_, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("expected the account to be locked after reaching the threshold, got %v", err)
	}
}

func TestAuthService_Refresh_RotatesTokenAndKeepsTheSameFamily(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")
	loginResponse, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	refreshResponse, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "203.0.113.1")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshResponse.RefreshToken == loginResponse.RefreshToken {
		t.Fatal("expected refresh to rotate to a new refresh token")
	}

	// The original (now-used) token must never work again.
	if _, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "203.0.113.1"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected the original refresh token to be rejected after rotation, got %v", err)
	}
}

func TestAuthService_Refresh_ReuseOfAUsedTokenRevokesTheWholeFamily(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")
	loginResponse, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	rotatedResponse, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "203.0.113.1")
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}

	// Reusing the already-consumed token simulates a stolen/replayed token.
	if _, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "198.51.100.9"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected reuse to be rejected, got %v", err)
	}

	// The legitimate, rotated token must also be dead: the whole family was revoked.
	if _, err := authService.Refresh(context.Background(), rotatedResponse.RefreshToken, "203.0.113.1"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected the rotated token's family to be revoked after reuse was detected, got %v", err)
	}
}

func TestAuthService_Logout_RevokesTheSession(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	createTestAccount(t, authService, store, "owner@myunivokai.dev", "correct-horse-battery-staple")
	loginResponse, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if err := authService.Logout(context.Background(), loginResponse.RefreshToken, "203.0.113.1"); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "203.0.113.1"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected the session to be unusable after logout, got %v", err)
	}
}

func TestAuthService_DisableAccount_RevokesSessionsAndBlocksLogin(t *testing.T) {
	authService, store, cache := newTestAuthService(t)
	account := createSuperAdminAccount(t, store, "owner@myunivokai.dev", "correct-horse-battery-staple")
	// A second super admin so disabling the first one is not blocked by the
	// last-super-admin guard under test separately below.
	createSuperAdminAccount(t, store, "second-admin@myunivokai.dev", "correct-horse-battery-staple")
	loginResponse, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if err := authService.DisableAccount(context.Background(), account.ID, "actor-account", "203.0.113.1"); err != nil {
		t.Fatalf("disable account: %v", err)
	}

	if _, err := authService.Refresh(context.Background(), loginResponse.RefreshToken, "203.0.113.1"); err == nil {
		t.Fatal("expected the pre-disable session to be revoked")
	}
	if _, err := authService.Login(context.Background(), contracts.LoginData{
		Email: "owner@myunivokai.dev", Password: "correct-horse-battery-staple",
	}, "203.0.113.1"); !errors.Is(err, ErrAccountDisabled) {
		t.Fatalf("expected ErrAccountDisabled, got %v", err)
	}
	cache.mu.Lock()
	_, cached := cache.versions[account.ID]
	cache.mu.Unlock()
	if !cached {
		t.Fatal("expected the bumped tokenVersion to be written to the cache")
	}
}

func TestAuthService_DisableAccount_RefusesToDisableTheLastSuperAdmin(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	onlySuperAdmin := createSuperAdminAccount(t, store, "owner@myunivokai.dev", "correct-horse-battery-staple")

	err := authService.DisableAccount(context.Background(), onlySuperAdmin.ID, "actor-account", "203.0.113.1")
	if !errors.Is(err, ErrLastSuperAdmin) {
		t.Fatalf("expected ErrLastSuperAdmin, got %v", err)
	}

	account, getErr := store.GetAccountByID(context.Background(), onlySuperAdmin.ID)
	if getErr != nil {
		t.Fatalf("get account: %v", getErr)
	}
	if account.Disabled {
		t.Fatal("expected the last super admin to remain enabled after the refused disable")
	}
}
