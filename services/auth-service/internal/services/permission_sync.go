package services

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

// enforcedPermissions are the codenames a gateway route actually checks today.
// Granting one of these changes what its holder can do, which is what a
// permission is supposed to mean.
//
// The guard that keeps this honest is not here — a list cannot check itself.
// It is TestEveryAdminManagementRouteDemandsAPermission in
// services/api-gateway/internal/handlers/admin_router_test.go, which refuses an
// authenticated account holding no permissions at every /api/admin route and so
// fails when a route is added without one.
var enforcedPermissions = []repositories.PermissionDefinition{
	{Codename: contracts.PermissionWorldRead, Description: "Read world records across families.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionJobRead, Description: "Read generation job records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionChartRead, Description: "Read business, platform and job-health charts.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAccountRead, Description: "Read staff account records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAccountManage, Description: "Create, disable and role-assign staff accounts.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAuditRead, Description: "Read the audit event log.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionRoleRead, Description: "Read role and permission records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionRoleManage, Description: "Create, edit and delete roles.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionSettingsRead, Description: "Read the platform's policy settings.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionSettingsManage, Description: "Change the platform's policy settings — quota ceilings, token lifetimes and the lockout window.", Audience: contracts.AccountAudienceAdmin},
}

// reservedPermissions are declared, synced and grantable — and checked by no
// route, because the screen each one was written for does not exist yet.
//
// This list is the correction of a claim this file used to make. The comment
// here said the set "only grows alongside the route that enforces it", while
// five codenames had been sitting in it since S4-AUTH-005 with nothing behind
// them. Two ways out were available and both were worse than saying so. Deleting
// them is not free: SyncPermissions ends in
// `DELETE FROM permissions WHERE NOT (codename = ANY($1))`, so a codename
// removed here is removed from production and from every role holding it, on the
// next boot, silently. Building the routes is a feature, not a correction.
//
// What is genuinely wrong is a checkbox in the Roles dialog that promises an
// ability nobody has. So each description says so in its own first clause —
// RoleFormDialog renders it directly under the checkbox — and the list is
// pinned by TestReservedPermissionsAreDeclaredDeliberately, so the next
// codename added without a route has to be added here on purpose rather than
// drifting in.
var reservedPermissions = []repositories.PermissionDefinition{
	{Codename: contracts.PermissionWorldUnpublish, Description: "Not enforced yet — no route revokes a share slug. Reserved for that screen.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionVariantRead, Description: "Not enforced yet — variants are read through world:read today. Reserved.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionJobRetry, Description: "Not enforced yet — no route retries a job. Reserved for that action.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionProfileRead, Description: "Not enforced yet — no route reads profiles. Reserved for that screen.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionProfileReveal, Description: "Not enforced yet — no route reveals masked input. Reserved, and audited when it exists.", Audience: contracts.AccountAudienceAdmin},
}

// declaredPermissions is the single source of truth for every permission
// codename that exists, and the only thing SyncPermissions is given — see
// agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
// The split above is for readers and for the two tests; the database sees one
// list, exactly as before.
var declaredPermissions = append(append([]repositories.PermissionDefinition{}, enforcedPermissions...), reservedPermissions...)

const (
	basicUserRoleName        = "basic_user"
	basicUserRoleDescription = "Seeded default: can view charts and nothing else. New accounts are inert until roles are granted deliberately."
)

// SyncPermissionsAndSeedRoles runs at every startup. It is idempotent, so it
// is safe to call on every boot rather than only on first install; the
// source of truth is always this code, never a row a previous run left
// behind.
func SyncPermissionsAndSeedRoles(ctx context.Context, store repositories.Store) error {
	if err := store.SyncPermissions(ctx, declaredPermissions); err != nil {
		return err
	}
	return store.EnsureSystemRole(ctx, basicUserRoleName, basicUserRoleDescription, contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
}
