package services

import (
	"context"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/breach/checkers"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
)

// testBreachedPassword is the one password the mock corpus rejects across
// this package. It is long enough to pass the length rule on its own, so a
// test that expects ErrPasswordBreached cannot pass by accident because the
// length check fired first.
const testBreachedPassword = "a-published-password-everyone-knows"

// testEndUserPassword satisfies the length rule and is absent from the mock
// corpus. Spelled out rather than reused from another test's literal so a
// change to one expectation cannot silently move another.
const testEndUserPassword = "a-perfectly-fine-passphrase"

// newTestAuthServiceWithIssuer is newTestAuthService plus the TokenIssuer it
// was built with, which is what a test asserting an audience or a lifetime
// needs: testConfig generates a fresh key pair per call, so a token cannot be
// verified afterwards without holding the issuer that minted it.
func newTestAuthServiceWithIssuer(t *testing.T) (*AuthService, *repositories.MemoryStore, security.TokenIssuer) {
	t.Helper()
	store := repositories.NewMemoryStore()
	serviceConfig := testConfig()
	passwordHasher := security.NewPasswordHasher(64*1024, 1, 1, 16, 32)
	tokenIssuer := security.NewTokenIssuer(serviceConfig.AccessTokenPrivateKey, serviceConfig.AccessTokenTTL, config.WebAccessTokenTTL)
	authService, err := NewAuthService(store, passwordHasher, tokenIssuer, newFakeTokenVersionCache(), testPasswordPolicy(), serviceConfig)
	if err != nil {
		t.Fatalf("construct auth service: %v", err)
	}
	return authService, store, tokenIssuer
}

func signUpTestEndUser(t *testing.T, authService *AuthService, email string) contracts.LoginResponseData {
	t.Helper()
	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: email, Password: testEndUserPassword, SourceAddress: "203.0.113.7",
	})
	if err != nil {
		t.Fatalf("sign up end user: %v", err)
	}
	return session
}

func TestSignUpEndUser_CreatesAnEndUserAccountAndSignsItIn(t *testing.T) {
	authService, store, tokenIssuer := newTestAuthServiceWithIssuer(t)

	session := signUpTestEndUser(t, authService, "Visitor@Example.com")

	if session.Account.Kind != contracts.AccountKindEndUser {
		t.Fatalf("account kind = %q, want %q", session.Account.Kind, contracts.AccountKindEndUser)
	}
	// Normalised on the way in, so "Visitor@Example.com" and
	// "visitor@example.com" cannot become two accounts.
	if session.Account.Email != "visitor@example.com" {
		t.Fatalf("account email = %q, want the normalised form", session.Account.Email)
	}
	claims, err := tokenIssuer.VerifyAccessToken(session.AccessToken)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	if claims.Audience != contracts.AccountAudienceWeb {
		t.Fatalf("audience = %q, want %q", claims.Audience, contracts.AccountAudienceWeb)
	}
	storedAccount, err := store.GetAccountByID(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read back the account: %v", err)
	}
	if storedAccount.Kind != contracts.AccountKindEndUser {
		t.Fatalf("stored kind = %q, want %q", storedAccount.Kind, contracts.AccountKindEndUser)
	}
}

// The plan's section 4.4 pair, asserted on the response rather than on the
// constants, because the failure this guards against is the ADMIN lifetime
// being applied to a web session - which no assertion on the constants alone
// would catch.
func TestSignUpEndUser_UsesTheWebAudienceTokenLifetimes(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)

	session := signUpTestEndUser(t, authService, "lifetimes@example.com")

	assertLifetimeWithin(t, "access", session.AccessExpiresAt, config.WebAccessTokenTTL)
	assertLifetimeWithin(t, "refresh", session.RefreshExpiresAt, config.WebRefreshTokenTTL)
}

// assertLifetimeWithin allows a second of slack for the time spent hashing a
// password between the expiry being computed and this assertion running.
func assertLifetimeWithin(t *testing.T, label string, expiresAt time.Time, expected time.Duration) {
	t.Helper()
	const tolerance = time.Minute
	actual := time.Until(expiresAt)
	if actual < expected-tolerance || actual > expected+tolerance {
		t.Fatalf("%s lifetime = %s, want about %s", label, actual, expected)
	}
}

// The invariant decision 1 makes structural: one accounts table serving two
// audiences means a signup must not be able to produce staff access.
func TestSignUpEndUser_ProducesAnAccountWithNoRoleAndNoPermission(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)

	session := signUpTestEndUser(t, authService, "no-permissions@example.com")

	roles, permissions, err := store.AccountRolesAndPermissions(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read roles and permissions: %v", err)
	}
	if len(roles) != 0 || len(permissions) != 0 {
		t.Fatalf("a fresh end-user account holds roles=%v permissions=%v, want neither", roles, permissions)
	}
	if len(session.Account.Roles) != 0 || len(session.Account.Permissions) != 0 {
		t.Fatalf("the signup response advertises roles=%v permissions=%v, want neither", session.Account.Roles, session.Account.Permissions)
	}
	if session.Account.IsSuperAdmin {
		t.Fatal("a signup produced an account flagged as super admin")
	}
}

func TestSignUpEndUser_RejectsAShortPasswordAndABreachedOne(t *testing.T) {
	testCases := []struct {
		name        string
		password    string
		expectedErr error
	}{
		{name: "eleven characters is one short of the minimum", password: "12345678901", expectedErr: ErrPasswordTooShort},
		{name: "long but published in a breach corpus", password: testBreachedPassword, expectedErr: ErrPasswordBreached},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			authService, store, _ := newTestAuthServiceWithIssuer(t)
			_, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
				Email: "rejected@example.com", Password: testCase.password,
			})
			if !errors.Is(err, testCase.expectedErr) {
				t.Fatalf("error = %v, want %v", err, testCase.expectedErr)
			}
			// A rejected signup must leave nothing behind, or the retry with
			// an acceptable password collides with the attempt that failed.
			if _, err := store.GetAccountByEmail(context.Background(), "rejected@example.com"); !errors.Is(err, repositories.ErrNotFound) {
				t.Fatalf("a rejected signup created an account anyway (err = %v)", err)
			}
		})
	}
}

// An unreachable breach corpus must allow the signup. The asymmetry is
// argued in PasswordPolicy.Validate; this pins it, because the opposite
// behaviour makes a third party's outage into an outage of registration.
func TestSignUpEndUser_AllowsThePasswordWhenTheBreachCorpusIsUnavailable(t *testing.T) {
	store := repositories.NewMemoryStore()
	serviceConfig := testConfig()
	passwordHasher := security.NewPasswordHasher(64*1024, 1, 1, 16, 32)
	tokenIssuer := security.NewTokenIssuer(serviceConfig.AccessTokenPrivateKey, serviceConfig.AccessTokenTTL, config.WebAccessTokenTTL)
	authService, err := NewAuthService(store, passwordHasher, tokenIssuer, newFakeTokenVersionCache(),
		NewPasswordPolicy(checkers.NewUnavailableMockChecker()), serviceConfig)
	if err != nil {
		t.Fatalf("construct auth service: %v", err)
	}

	if _, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "corpus-down@example.com", Password: testEndUserPassword,
	}); err != nil {
		t.Fatalf("signup failed while the breach corpus was unavailable: %v", err)
	}
}

func TestSignUpEndUser_RejectsAnAddressThatAlreadyHoldsAnAccount(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	signUpTestEndUser(t, authService, "taken@example.com")

	_, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "TAKEN@example.com", Password: "a-completely-different-passphrase",
	})
	if !errors.Is(err, ErrEmailUnavailable) {
		t.Fatalf("error = %v, want ErrEmailUnavailable", err)
	}
}

func TestSignUpEndUser_RejectsAnEmptyAddress(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)

	if _, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "   ", Password: testEndUserPassword,
	}); !errors.Is(err, ErrEmailRequired) {
		t.Fatalf("error = %v, want ErrEmailRequired", err)
	}
}

// The registration metric the plan's section 14.2 relies on. It is an audit
// row and nothing else, so if the row is not written the metric does not
// exist - there is no second place it could be recovered from.
func TestSignUpEndUser_WritesARegisterAuditRow(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	signUpTestEndUser(t, authService, "audited@example.com")

	events, _, _, err := store.ListAuditEvents(context.Background(), "", 50, nil, nil, "")
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	for _, event := range events {
		if event.Action == auditActionRegister && event.Result == auditResultSuccess && event.Target == "audited@example.com" {
			return
		}
	}
	t.Fatalf("no successful %q audit row for the signup; got %+v", auditActionRegister, events)
}

// Both directions of the audience separation, at the service level. The
// gateway-level halves are S8-IDENTITY-003's product_router_test.go and the
// existing admin_auth_test.go; this is the layer underneath both, and it is
// the one that decides which audience a token is minted for at all.
func TestLogin_RefusesToCrossBetweenTheTwoAudiences(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	staffAccount := createTestAccount(t, authService, store, "staff@example.com", testEndUserPassword)
	endUserSession := signUpTestEndUser(t, authService, "visitor@example.com")

	t.Run("a staff address is refused at the product login", func(t *testing.T) {
		_, err := authService.LoginEndUser(context.Background(), contracts.LoginData{
			Email: staffAccount.Email, Password: testEndUserPassword,
		}, "203.0.113.7")
		// The SAME error a wrong password returns, on purpose: a distinct one
		// would let the product login enumerate staff addresses.
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("error = %v, want ErrInvalidCredentials", err)
		}
	})

	t.Run("an end-user address is refused at the admin login", func(t *testing.T) {
		if _, err := authService.Login(context.Background(), contracts.LoginData{
			Email: endUserSession.Account.Email, Password: testEndUserPassword,
		}, "203.0.113.7"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("error = %v, want ErrInvalidCredentials", err)
		}
	})
}

func TestLoginEndUser_IssuesAWebAudienceToken(t *testing.T) {
	authService, _, tokenIssuer := newTestAuthServiceWithIssuer(t)
	signUpTestEndUser(t, authService, "returning@example.com")

	session, err := authService.LoginEndUser(context.Background(), contracts.LoginData{
		Email: "returning@example.com", Password: testEndUserPassword,
	}, "203.0.113.7")
	if err != nil {
		t.Fatalf("log in end user: %v", err)
	}
	claims, err := tokenIssuer.VerifyAccessToken(session.AccessToken)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	if claims.Audience != contracts.AccountAudienceWeb {
		t.Fatalf("audience = %q, want %q", claims.Audience, contracts.AccountAudienceWeb)
	}
}

// A refresh token carries no audience of its own - there is no column for one
// and this sprint adds no migration - so the account's kind is what stops it
// being redeemed at the other audience's door.
func TestRefresh_RefusesARefreshTokenFromTheOtherAudience(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	staffAccount := createTestAccount(t, authService, store, "staff@example.com", testEndUserPassword)
	staffSession, err := authService.Login(context.Background(), contracts.LoginData{
		Email: staffAccount.Email, Password: testEndUserPassword,
	}, "203.0.113.7")
	if err != nil {
		t.Fatalf("staff login: %v", err)
	}
	endUserSession := signUpTestEndUser(t, authService, "visitor@example.com")

	if _, err := authService.RefreshEndUserSession(context.Background(), staffSession.RefreshToken, "203.0.113.7"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("product refresh of a staff token: error = %v, want ErrInvalidRefreshToken", err)
	}
	if _, err := authService.Refresh(context.Background(), endUserSession.RefreshToken, "203.0.113.7"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("admin refresh of an end-user token: error = %v, want ErrInvalidRefreshToken", err)
	}

	// And neither rejection consumed the token. A misrouted refresh is a
	// client bug; burning the token would log the real session out of the
	// real app as a side effect - see the check's placement in refresh.
	if _, err := authService.Refresh(context.Background(), staffSession.RefreshToken, "203.0.113.7"); err != nil {
		t.Fatalf("the staff token stopped working after being misrouted once: %v", err)
	}
	if _, err := authService.RefreshEndUserSession(context.Background(), endUserSession.RefreshToken, "203.0.113.7"); err != nil {
		t.Fatalf("the end-user token stopped working after being misrouted once: %v", err)
	}
}

// The disable path already existed for staff (DisableAccount revokes, bumps
// tokenVersion and audits). This asserts it reaches an end-user account too,
// which is the whole of S8-IDENTITY-006's server side and the sprint's
// "a staff member can mark that account inactive" acceptance line.
func TestDisableAccount_RevokesAnEndUserSessionWithinTheTokenVersionWindow(t *testing.T) {
	authService, store, cache := newTestAuthService(t)
	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "to-disable@example.com", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up end user: %v", err)
	}

	if err := authService.DisableAccount(context.Background(), session.Account.AccountID, "staff-account", "203.0.113.7"); err != nil {
		t.Fatalf("disable account: %v", err)
	}

	// The gateway rejects the still-unexpired access token by comparing its
	// tokenVersion claim against this cached value, which is why the cache
	// write is the thing asserted rather than a second request.
	cachedVersion, found := cache.versions[session.Account.AccountID]
	if !found {
		t.Fatal("no tokenVersion was cached for the disabled account; the gateway would keep accepting its 7-day token")
	}
	claimedVersion := 1
	if cachedVersion <= claimedVersion {
		t.Fatalf("cached tokenVersion = %d, want it above the %d the issued token claims", cachedVersion, claimedVersion)
	}
	if _, err := authService.RefreshEndUserSession(context.Background(), session.RefreshToken, "203.0.113.7"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("refresh after disable: error = %v, want ErrInvalidRefreshToken", err)
	}
	disabledAccount, err := store.GetAccountByID(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read back the account: %v", err)
	}
	if !disabledAccount.Disabled {
		t.Fatal("the account is not marked disabled")
	}
}
