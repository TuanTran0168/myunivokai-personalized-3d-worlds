package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
)

const inviteTokenByteLength = 32

const (
	defaultListPageSize = 20
	maximumListPageSize = 100
)

const (
	auditActionAccountCreate = "account_create"
	auditActionAccountUpdate = "account_update"
	auditActionInviteCreate  = "invite_create"
	auditActionInviteAccept  = "invite_accept"
	auditActionRoleCreate    = "role_create"
	auditActionRoleUpdate    = "role_update"
	auditActionRoleDelete    = "role_delete"
	auditActionRoleAssign    = "role_assign"
	auditActionRoleRevoke    = "role_revoke"
)

// minimumAccountPasswordLength matches cmd/bootstrap's own check for the
// same reason: both are an admin choosing a password for an account that
// isn't the one signing in yet, and the two should not be free to drift.
const minimumAccountPasswordLength = 12

var (
	ErrInvalidInviteToken  = errors.New("invalid or expired invite token")
	ErrSystemRoleImmutable = errors.New("system roles cannot be modified or deleted")
	ErrSelfRevokeForbidden = errors.New("cannot revoke your own account:manage or role:manage permission")
	ErrPasswordTooShort    = errors.New("password does not meet the minimum length")
)

// RoleInUseError carries the count the vision doc requires a role-delete
// rejection to report - see
// notes/plans/services/auth-and-admin-plan.md#lockout-guards--enforced-server-side-not-in-the-ui.
type RoleInUseError struct {
	AccountCount int
}

func (err *RoleInUseError) Error() string {
	return fmt.Sprintf("role is assigned to %d account(s)", err.AccountCount)
}

// InviteAccount creates a staff account with no password: RoleIDs are
// granted immediately so the invite is never role-less, and the raw token
// is returned exactly once — no email infrastructure exists yet, so an
// operator relays it out of band (see contracts.InviteCreateResponseData).
func (service *AuthService) InviteAccount(ctx context.Context, data contracts.InviteCreateData) (contracts.InviteCreateResponseData, error) {
	rawToken, tokenHash, err := generateInviteToken()
	if err != nil {
		return contracts.InviteCreateResponseData{}, err
	}
	expiresAt := time.Now().UTC().Add(service.cfg.InviteTokenTTL)
	account, err := service.store.CreateInvite(ctx, repositories.InviteAccountParams{
		Email: normalizeEmail(data.Email), RoleIDs: data.RoleIDs, InviteTokenHash: tokenHash, InviteExpiresAt: expiresAt,
	})
	if err != nil {
		return contracts.InviteCreateResponseData{}, err
	}
	service.audit(ctx, &data.ActorAccountID, auditActionInviteCreate, account.Email, auditResultSuccess, data.SourceAddress)
	return contracts.InviteCreateResponseData{AccountID: account.ID, InviteToken: rawToken, InviteExpiresAt: expiresAt}, nil
}

// CreateAccount creates a staff account with a password the actor chooses
// right away, active from the moment it exists — the direct alternative to
// InviteAccount's token dance, adopted because no email infrastructure
// exists to relay an invite link; see
// notes/plans/services/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
func (service *AuthService) CreateAccount(ctx context.Context, data contracts.AccountCreateData) (contracts.AccountSummary, error) {
	if len(data.Password) < minimumAccountPasswordLength {
		return contracts.AccountSummary{}, ErrPasswordTooShort
	}
	passwordHash, err := service.passwordHasher.Hash(data.Password)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	account, err := service.store.CreateAccount(ctx, repositories.CreateAccountParams{
		Email: normalizeEmail(data.Email), Name: data.Name, PasswordHash: passwordHash, Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	for _, roleID := range data.RoleIDs {
		if err := service.store.AssignRole(ctx, account.ID, roleID); err != nil {
			return contracts.AccountSummary{}, err
		}
	}
	service.audit(ctx, &data.ActorAccountID, auditActionAccountCreate, account.Email, auditResultSuccess, data.SourceAddress)
	roles, permissions, err := service.store.AccountRolesAndPermissions(ctx, account.ID)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	return toAccountSummary(account, roles, permissions), nil
}

// UpdateAccount changes an account's email and/or name — see
// contracts.AccountUpdateData for why nothing else is editable here.
func (service *AuthService) UpdateAccount(ctx context.Context, data contracts.AccountUpdateData) (contracts.AccountSummary, error) {
	account, err := service.store.UpdateAccount(ctx, data.AccountID, normalizeEmail(data.Email), data.Name)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	service.audit(ctx, &data.ActorAccountID, auditActionAccountUpdate, account.Email, auditResultSuccess, data.SourceAddress)
	roles, permissions, err := service.store.AccountRolesAndPermissions(ctx, account.ID)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	return toAccountSummary(account, roles, permissions), nil
}

// AcceptInvite sets the account's first password and immediately logs it
// in, the same way accepting an invite works in every comparable admin
// tool — the returned session is a normal LoginResponseData.
func (service *AuthService) AcceptInvite(ctx context.Context, data contracts.InviteAcceptData) (contracts.LoginResponseData, error) {
	tokenHash := security.HashRefreshToken(data.InviteToken)
	account, err := service.store.GetAccountByInviteTokenHash(ctx, tokenHash)
	if errors.Is(err, repositories.ErrNotFound) {
		return contracts.LoginResponseData{}, ErrInvalidInviteToken
	}
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	if account.InviteExpiresAt == nil || account.InviteExpiresAt.Before(time.Now().UTC()) {
		return contracts.LoginResponseData{}, ErrInvalidInviteToken
	}
	passwordHash, err := service.passwordHasher.Hash(data.Password)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	account, err = service.store.AcceptInvite(ctx, account.ID, passwordHash)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	response, err := service.issueSession(ctx, account, uuid.NewString())
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	service.audit(ctx, &account.ID, auditActionInviteAccept, account.Email, auditResultSuccess, data.SourceAddress)
	return response, nil
}

func generateInviteToken() (raw, hash string, err error) {
	buffer := make([]byte, inviteTokenByteLength)
	if _, err = rand.Read(buffer); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(buffer)
	// A random 256-bit token, not a user password - SHA-256 is the right
	// tool here for the same reason GenerateRefreshToken uses it, not Argon2id.
	return raw, security.HashRefreshToken(raw), nil
}

func (service *AuthService) ListAccounts(ctx context.Context, cursor string, pageSize int, search string) (contracts.AccountListResponseData, error) {
	accounts, nextCursor, err := service.store.ListAccounts(ctx, cursor, clampListPageSize(pageSize), search)
	if err != nil {
		return contracts.AccountListResponseData{}, err
	}
	summaries := make([]contracts.AccountSummary, 0, len(accounts))
	for _, account := range accounts {
		roles, permissions, err := service.store.AccountRolesAndPermissions(ctx, account.ID)
		if err != nil {
			return contracts.AccountListResponseData{}, err
		}
		summaries = append(summaries, toAccountSummary(account, roles, permissions))
	}
	return contracts.AccountListResponseData{Accounts: summaries, NextCursor: nextCursor}, nil
}

func (service *AuthService) GetAccount(ctx context.Context, accountID string) (contracts.AccountSummary, error) {
	account, err := service.store.GetAccountByID(ctx, accountID)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	roles, permissions, err := service.store.AccountRolesAndPermissions(ctx, accountID)
	if err != nil {
		return contracts.AccountSummary{}, err
	}
	return toAccountSummary(account, roles, permissions), nil
}

// AccountPermissions answers the gateway's RequireAdminPermission check — a
// fresh lookup per call rather than a cache, since admin-management traffic
// is low-volume staff usage, not the hot path S4-AUTH-003's tokenVersion
// cache exists for.
func (service *AuthService) AccountPermissions(ctx context.Context, accountID string) (contracts.AccountPermissionsResponseData, error) {
	account, err := service.store.GetAccountByID(ctx, accountID)
	if err != nil {
		return contracts.AccountPermissionsResponseData{}, err
	}
	_, permissions, err := service.store.AccountRolesAndPermissions(ctx, accountID)
	if err != nil {
		return contracts.AccountPermissionsResponseData{}, err
	}
	return contracts.AccountPermissionsResponseData{Permissions: permissions, IsSuperAdmin: account.IsSuperAdmin}, nil
}

// ListRoles never paginates: roles are staff-composed, not user-generated,
// and realistically number in the dozens - NextCursor stays empty rather
// than building pagination for a collection that will never need it.
func (service *AuthService) ListRoles(ctx context.Context) (contracts.RoleListResponseData, error) {
	roles, err := service.store.ListRoles(ctx)
	if err != nil {
		return contracts.RoleListResponseData{}, err
	}
	summaries := make([]contracts.RoleSummary, 0, len(roles))
	for _, role := range roles {
		summaries = append(summaries, toRoleSummary(role))
	}
	return contracts.RoleListResponseData{Roles: summaries}, nil
}

func (service *AuthService) CreateRole(ctx context.Context, data contracts.RoleCreateData) (contracts.RoleSummary, error) {
	role, err := service.store.CreateRole(ctx, data.Name, data.Description, data.Audience, data.Permissions)
	if err != nil {
		return contracts.RoleSummary{}, err
	}
	service.audit(ctx, &data.ActorAccountID, auditActionRoleCreate, role.ID, auditResultSuccess, data.SourceAddress)
	return toRoleSummary(role), nil
}

// UpdateRole and DeleteRole audit BEFORE the write takes effect, unlike
// every other mutation in this file — a deliberate exception the vision doc
// calls for specifically for role edits/deletes, not an inconsistency:
// "Deleting/editing a role writes an audit row before it takes effect." See
// notes/plans/services/auth-and-admin-plan.md#lockout-guards--enforced-server-side-not-in-the-ui.
func (service *AuthService) UpdateRole(ctx context.Context, data contracts.RoleUpdateData) (contracts.RoleSummary, error) {
	existing, err := service.store.GetRoleByID(ctx, data.RoleID)
	if err != nil {
		return contracts.RoleSummary{}, err
	}
	if existing.IsSystem {
		return contracts.RoleSummary{}, ErrSystemRoleImmutable
	}
	service.audit(ctx, &data.ActorAccountID, auditActionRoleUpdate, data.RoleID, auditResultSuccess, data.SourceAddress)
	role, err := service.store.UpdateRole(ctx, data.RoleID, data.Description, data.Permissions)
	if err != nil {
		return contracts.RoleSummary{}, err
	}
	return toRoleSummary(role), nil
}

func (service *AuthService) DeleteRole(ctx context.Context, data contracts.RoleDeleteData) error {
	existing, err := service.store.GetRoleByID(ctx, data.RoleID)
	if err != nil {
		return err
	}
	if existing.IsSystem {
		return ErrSystemRoleImmutable
	}
	accountsHolding, err := service.store.CountAccountsWithRole(ctx, data.RoleID)
	if err != nil {
		return err
	}
	if accountsHolding > 0 {
		return &RoleInUseError{AccountCount: accountsHolding}
	}
	service.audit(ctx, &data.ActorAccountID, auditActionRoleDelete, data.RoleID, auditResultSuccess, data.SourceAddress)
	return service.store.DeleteRole(ctx, data.RoleID)
}

func (service *AuthService) AssignRole(ctx context.Context, data contracts.RoleAssignData) error {
	if err := service.store.AssignRole(ctx, data.AccountID, data.RoleID); err != nil {
		return err
	}
	service.audit(ctx, &data.ActorAccountID, auditActionRoleAssign, data.AccountID+":"+data.RoleID, auditResultSuccess, data.SourceAddress)
	return nil
}

// RevokeRole blocks an account from revoking its OWN account:manage or
// role:manage — the one lockout guard here that depends on who the caller
// is, not just what they're revoking. Revoking someone ELSE's role is a
// different admin's call and is never blocked by this check.
func (service *AuthService) RevokeRole(ctx context.Context, data contracts.RoleRevokeData) error {
	if data.AccountID == data.ActorAccountID {
		_, currentPermissions, err := service.store.AccountRolesAndPermissions(ctx, data.AccountID)
		if err != nil {
			return err
		}
		remainingPermissions, err := service.store.AccountPermissionsExcludingRole(ctx, data.AccountID, data.RoleID)
		if err != nil {
			return err
		}
		for _, guarded := range []contracts.PermissionCode{contracts.PermissionAccountManage, contracts.PermissionRoleManage} {
			if containsPermission(currentPermissions, guarded) && !containsPermission(remainingPermissions, guarded) {
				return ErrSelfRevokeForbidden
			}
		}
	}
	if err := service.store.RevokeRole(ctx, data.AccountID, data.RoleID); err != nil {
		return err
	}
	service.audit(ctx, &data.ActorAccountID, auditActionRoleRevoke, data.AccountID+":"+data.RoleID, auditResultSuccess, data.SourceAddress)
	return nil
}

func (service *AuthService) ListPermissions(ctx context.Context) (contracts.PermissionListResponseData, error) {
	permissions, err := service.store.ListPermissions(ctx)
	if err != nil {
		return contracts.PermissionListResponseData{}, err
	}
	summaries := make([]contracts.PermissionSummary, 0, len(permissions))
	for _, permission := range permissions {
		summaries = append(summaries, contracts.PermissionSummary{
			Codename: permission.Codename, Description: permission.Description, Audience: permission.Audience,
		})
	}
	return contracts.PermissionListResponseData{Permissions: summaries}, nil
}

func (service *AuthService) ListAuditEvents(ctx context.Context, cursor string, pageSize int, since, until *time.Time, search string) (contracts.AuditListResponseData, error) {
	events, nextCursor, totalCount, err := service.store.ListAuditEvents(ctx, cursor, clampListPageSize(pageSize), since, until, search)
	if err != nil {
		return contracts.AuditListResponseData{}, err
	}
	summaries := make([]contracts.AuditEventSummary, 0, len(events))
	for _, event := range events {
		var actorAccountID string
		if event.ActorAccountID != nil {
			actorAccountID = *event.ActorAccountID
		}
		summaries = append(summaries, contracts.AuditEventSummary{
			AuditEventID: event.ID, ActorAccountID: actorAccountID, Action: event.Action,
			Target: event.Target, Result: event.Result, SourceAddress: event.SourceAddress, OccurredAt: event.OccurredAt,
		})
	}
	return contracts.AuditListResponseData{Events: summaries, NextCursor: nextCursor, TotalCount: totalCount}, nil
}

func toAccountSummary(account repositories.Account, roles, permissions []string) contracts.AccountSummary {
	return contracts.AccountSummary{
		AccountID: account.ID, Email: account.Email, Name: account.Name, Kind: account.Kind,
		Roles: roles, Permissions: permissions, IsSuperAdmin: account.IsSuperAdmin,
		Disabled: account.Disabled, ForcePasswordChange: account.ForcePasswordChange, CreatedAt: account.CreatedAt,
	}
}

func toRoleSummary(role repositories.Role) contracts.RoleSummary {
	return contracts.RoleSummary{
		RoleID: role.ID, Name: role.Name, Description: role.Description,
		Audience: role.Audience, IsSystem: role.IsSystem, Permissions: role.PermissionCodenames,
	}
}

func containsPermission(permissions []string, code contracts.PermissionCode) bool {
	for _, permission := range permissions {
		if permission == string(code) {
			return true
		}
	}
	return false
}

func clampListPageSize(pageSize int) int {
	if pageSize <= 0 {
		return defaultListPageSize
	}
	if pageSize > maximumListPageSize {
		return maximumListPageSize
	}
	return pageSize
}
