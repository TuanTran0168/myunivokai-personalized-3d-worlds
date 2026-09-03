package services

import (
	"context"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

func TestAuthService_InviteAccount_CreatesAccountWithRolesAndReturnsToken(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	role, err := store.CreateRole(context.Background(), "analyst", "reads charts", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	response, err := authService.InviteAccount(context.Background(), contracts.InviteCreateData{
		Email: "new-staff@example.com", RoleIDs: []string{role.ID}, ActorAccountID: "actor-1", SourceAddress: "203.0.113.1",
	})
	if err != nil {
		t.Fatalf("invite account: %v", err)
	}
	if response.InviteToken == "" || response.AccountID == "" {
		t.Fatalf("expected a non-empty invite token and account id: %+v", response)
	}
	account, err := store.GetAccountByID(context.Background(), response.AccountID)
	if err != nil {
		t.Fatalf("get invited account: %v", err)
	}
	if account.PasswordHash != "" {
		t.Fatal("an invited account must have no password until it accepts")
	}
	roles, _, err := store.AccountRolesAndPermissions(context.Background(), response.AccountID)
	if err != nil {
		t.Fatalf("account roles: %v", err)
	}
	if len(roles) != 1 || roles[0] != "analyst" {
		t.Fatalf("expected the invited account to already hold the analyst role, got %v", roles)
	}
}

func TestAuthService_CreateAccount_CreatesAnActiveAccountWithRoles(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	role, err := store.CreateRole(context.Background(), "analyst", "reads charts", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	summary, err := authService.CreateAccount(context.Background(), contracts.AccountCreateData{
		Email: "direct-staff@example.com", Password: "a-strong-new-password-1", RoleIDs: []string{role.ID}, ActorAccountID: "actor-1", SourceAddress: "203.0.113.1",
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if summary.AccountID == "" || summary.Disabled || summary.ForcePasswordChange {
		t.Fatalf("expected a newly created, active, non-force-change account: %+v", summary)
	}
	if len(summary.Roles) != 1 || summary.Roles[0] != "analyst" {
		t.Fatalf("expected the created account to already hold the analyst role, got %v", summary.Roles)
	}
	// It must be usable immediately, with no accept-invite step.
	if _, err := authService.Login(context.Background(), contracts.LoginData{Email: "direct-staff@example.com", Password: "a-strong-new-password-1"}, "203.0.113.1"); err != nil {
		t.Fatalf("expected the created account to log in immediately: %v", err)
	}
}

func TestAuthService_CreateAccount_RejectsAShortPassword(t *testing.T) {
	authService, _, _ := newTestAuthService(t)
	if _, err := authService.CreateAccount(context.Background(), contracts.AccountCreateData{
		Email: "direct-staff@example.com", Password: "too-short",
	}); !errors.Is(err, ErrPasswordTooShort) {
		t.Fatalf("expected ErrPasswordTooShort, got %v", err)
	}
}

func TestAuthService_CreateAccount_RejectsADuplicateEmail(t *testing.T) {
	authService, _, _ := newTestAuthService(t)
	if _, err := authService.CreateAccount(context.Background(), contracts.AccountCreateData{
		Email: "direct-staff@example.com", Password: "a-strong-new-password-1",
	}); err != nil {
		t.Fatalf("create first account: %v", err)
	}
	if _, err := authService.CreateAccount(context.Background(), contracts.AccountCreateData{
		Email: "direct-staff@example.com", Password: "a-different-password-2",
	}); !errors.Is(err, repositories.ErrConflict) {
		t.Fatalf("expected ErrConflict for a duplicate email, got %v", err)
	}
}

func TestAuthService_UpdateAccount_ChangesEmail(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "old-email@example.com", "a-strong-new-password-1")
	summary, err := authService.UpdateAccount(context.Background(), contracts.AccountUpdateData{
		AccountID: account.ID, Email: "new-email@example.com", ActorAccountID: "actor-1", SourceAddress: "203.0.113.1",
	})
	if err != nil {
		t.Fatalf("update account: %v", err)
	}
	if summary.Email != "new-email@example.com" {
		t.Fatalf("expected the email to change, got %q", summary.Email)
	}
}

func TestAuthService_AcceptInvite_SetsPasswordAndLogsIn(t *testing.T) {
	authService, _, _ := newTestAuthService(t)
	invite, err := authService.InviteAccount(context.Background(), contracts.InviteCreateData{Email: "new-staff@example.com", ActorAccountID: "actor-1", SourceAddress: "203.0.113.1"})
	if err != nil {
		t.Fatalf("invite account: %v", err)
	}
	session, err := authService.AcceptInvite(context.Background(), contracts.InviteAcceptData{
		InviteToken: invite.InviteToken, Password: "a-strong-new-password-1", SourceAddress: "203.0.113.1",
	})
	if err != nil {
		t.Fatalf("accept invite: %v", err)
	}
	if session.AccessToken == "" || session.Account.AccountID != invite.AccountID {
		t.Fatalf("expected a real session for the accepted account: %+v", session)
	}

	// The token is single-use: accepting it twice must fail, not silently log in again.
	if _, err := authService.AcceptInvite(context.Background(), contracts.InviteAcceptData{
		InviteToken: invite.InviteToken, Password: "another-password-2", SourceAddress: "203.0.113.1",
	}); !errors.Is(err, ErrInvalidInviteToken) {
		t.Fatalf("expected ErrInvalidInviteToken on reuse, got %v", err)
	}
}

// The expiry is written straight into the row rather than configured, and the
// change is the point: this test used to set InviteTokenTTL to minus one hour.
// auth.token.invite_ttl now declares a floor of one hour, so no configuration
// and no operator can produce an invite that is expired when it is created —
// the bounds refuse it. What is left to test is the row, which is what an
// expired invite actually is, and reaching it through the store is more honest
// than a lifetime nothing could ever set.
func TestAuthService_AcceptInvite_RejectsAnExpiredToken(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	rawInviteToken, inviteTokenHash, err := generateInviteToken()
	if err != nil {
		t.Fatalf("generate invite token: %v", err)
	}
	if _, err := store.CreateInvite(context.Background(), repositories.InviteAccountParams{
		Email: "new-staff@example.com", InviteTokenHash: inviteTokenHash,
		InviteExpiresAt: time.Now().UTC().Add(-time.Hour),
	}); err != nil {
		t.Fatalf("create expired invite: %v", err)
	}
	if _, err := authService.AcceptInvite(context.Background(), contracts.InviteAcceptData{InviteToken: rawInviteToken, Password: "a-strong-password-1"}); !errors.Is(err, ErrInvalidInviteToken) {
		t.Fatalf("expected ErrInvalidInviteToken for an expired invite, got %v", err)
	}
}

func TestAuthService_AcceptInvite_RejectsAnUnknownToken(t *testing.T) {
	authService, _, _ := newTestAuthService(t)
	if _, err := authService.AcceptInvite(context.Background(), contracts.InviteAcceptData{InviteToken: "not-a-real-token", Password: "a-strong-password-1"}); !errors.Is(err, ErrInvalidInviteToken) {
		t.Fatalf("expected ErrInvalidInviteToken for an unknown token, got %v", err)
	}
}

func TestAuthService_DeleteRole_RefusesWhenAccountsHoldIt(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "staff@example.com", "a-strong-password-1")
	role, err := store.CreateRole(context.Background(), "analyst", "", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if err := authService.AssignRole(context.Background(), contracts.RoleAssignData{AccountID: account.ID, RoleID: role.ID, ActorAccountID: "actor-1"}); err != nil {
		t.Fatalf("assign role: %v", err)
	}
	err = authService.DeleteRole(context.Background(), contracts.RoleDeleteData{RoleID: role.ID, ActorAccountID: "actor-1"})
	var roleInUseError *RoleInUseError
	if !errors.As(err, &roleInUseError) || roleInUseError.AccountCount != 1 {
		t.Fatalf("expected a RoleInUseError reporting 1 account, got %v", err)
	}
}

func TestAuthService_DeleteRole_RefusesASystemRole(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	if err := store.EnsureSystemRole(context.Background(), "basic_user", "seeded", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)}); err != nil {
		t.Fatalf("ensure system role: %v", err)
	}
	roles, err := store.ListRoles(context.Background())
	if err != nil || len(roles) != 1 {
		t.Fatalf("list roles: roles=%v err=%v", roles, err)
	}
	if err := authService.DeleteRole(context.Background(), contracts.RoleDeleteData{RoleID: roles[0].ID, ActorAccountID: "actor-1"}); !errors.Is(err, ErrSystemRoleImmutable) {
		t.Fatalf("expected ErrSystemRoleImmutable, got %v", err)
	}
}

func TestAuthService_UpdateRole_RefusesASystemRole(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	if err := store.EnsureSystemRole(context.Background(), "basic_user", "seeded", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)}); err != nil {
		t.Fatalf("ensure system role: %v", err)
	}
	roles, err := store.ListRoles(context.Background())
	if err != nil || len(roles) != 1 {
		t.Fatalf("list roles: roles=%v err=%v", roles, err)
	}
	_, err = authService.UpdateRole(context.Background(), contracts.RoleUpdateData{RoleID: roles[0].ID, Description: "hijacked", ActorAccountID: "actor-1"})
	if !errors.Is(err, ErrSystemRoleImmutable) {
		t.Fatalf("expected ErrSystemRoleImmutable, got %v", err)
	}
}

// RevokeRole must block an account from revoking a role FROM ITSELF when
// that role is the account's only source of account:manage/role:manage -
// see agent-system/plans/services/auth-and-admin-plan.md#lockout-guards--enforced-server-side-not-in-the-ui.
func TestAuthService_RevokeRole_BlocksRevokingItsOwnLastAccountManageRole(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "staff@example.com", "a-strong-password-1")
	role, err := store.CreateRole(context.Background(), "admin_manager", "", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionAccountManage)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if err := store.AssignRole(context.Background(), account.ID, role.ID); err != nil {
		t.Fatalf("assign role: %v", err)
	}
	err = authService.RevokeRole(context.Background(), contracts.RoleRevokeData{AccountID: account.ID, RoleID: role.ID, ActorAccountID: account.ID})
	if !errors.Is(err, ErrSelfRevokeForbidden) {
		t.Fatalf("expected ErrSelfRevokeForbidden, got %v", err)
	}
}

// The same revoke, performed by a DIFFERENT admin against someone else's
// account, must succeed — the guard is about self-revocation specifically,
// not about account:manage/role:manage roles in general.
func TestAuthService_RevokeRole_AllowsAnotherAdminToRevokeSomeoneElsesRole(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "staff@example.com", "a-strong-password-1")
	actor := createTestAccount(t, authService, store, "actor@example.com", "a-strong-password-1")
	role, err := store.CreateRole(context.Background(), "admin_manager", "", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionAccountManage)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if err := store.AssignRole(context.Background(), account.ID, role.ID); err != nil {
		t.Fatalf("assign role: %v", err)
	}
	if err := authService.RevokeRole(context.Background(), contracts.RoleRevokeData{AccountID: account.ID, RoleID: role.ID, ActorAccountID: actor.ID}); err != nil {
		t.Fatalf("expected another admin to be able to revoke this role, got %v", err)
	}
}

// Revoking a role that grants NEITHER account:manage nor role:manage, from
// yourself, must be allowed — the guard is scoped to those two permissions.
func TestAuthService_RevokeRole_AllowsSelfRevokeOfAnUnrelatedRole(t *testing.T) {
	authService, store, _ := newTestAuthService(t)
	account := createTestAccount(t, authService, store, "staff@example.com", "a-strong-password-1")
	role, err := store.CreateRole(context.Background(), "chart_viewer", "", contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if err := store.AssignRole(context.Background(), account.ID, role.ID); err != nil {
		t.Fatalf("assign role: %v", err)
	}
	if err := authService.RevokeRole(context.Background(), contracts.RoleRevokeData{AccountID: account.ID, RoleID: role.ID, ActorAccountID: account.ID}); err != nil {
		t.Fatalf("expected self-revoke of an unrelated role to succeed, got %v", err)
	}
}
