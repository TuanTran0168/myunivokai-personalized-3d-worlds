package services

import (
	"context"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

func TestSyncPermissionsAndSeedRoles_SeedsBasicUserWithChartReadOnly(t *testing.T) {
	store := repositories.NewMemoryStore()
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("sync: %v", err)
	}

	account, err := store.CreateAccount(context.Background(), repositories.CreateAccountParams{
		Email: "basic@myunivokai.dev", PasswordHash: "irrelevant", Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	store.AssignRoleByName(account.ID, basicUserRoleName)

	roles, permissions, err := store.AccountRolesAndPermissions(context.Background(), account.ID)
	if err != nil {
		t.Fatalf("account roles and permissions: %v", err)
	}
	if len(roles) != 1 || roles[0] != basicUserRoleName {
		t.Fatalf("expected exactly the basic_user role, got %v", roles)
	}
	if len(permissions) != 1 || permissions[0] != string(contracts.PermissionChartRead) {
		t.Fatalf("expected basic_user to hold only chart:read, got %v", permissions)
	}
}

// A permission nothing checks is a promise the console cannot keep: it appears
// as a checkbox in the Roles dialog, a staff member grants it, and the holder
// gains nothing. Five of them had accumulated unnoticed, so the set is pinned
// here — adding a codename with no route behind it now means editing this list
// on purpose, and adding the route means moving it out of reservedPermissions
// in the same change.
func TestReservedPermissionsAreDeclaredDeliberately(t *testing.T) {
	expected := map[contracts.PermissionCode]bool{
		contracts.PermissionWorldUnpublish: true,
		contracts.PermissionVariantRead:    true,
		contracts.PermissionJobRetry:       true,
		contracts.PermissionProfileRead:    true,
		contracts.PermissionProfileReveal:  true,
	}
	for _, permission := range reservedPermissions {
		if !expected[permission.Codename] {
			t.Errorf("%q is reserved but not in the pinned set; if a route now enforces it, move it to enforcedPermissions", permission.Codename)
		}
		delete(expected, permission.Codename)
	}
	for codename := range expected {
		t.Errorf("%q left reservedPermissions; if that is because a route now enforces it, update this test with the route", codename)
	}
}

// The two lists are a reader's aid, not a second source of truth. If one
// codename fell out of both, or appeared in both, the database would silently
// disagree with the split — and SyncPermissions deletes anything not declared.
func TestEveryDeclaredPermissionIsEitherEnforcedOrReserved(t *testing.T) {
	seen := make(map[contracts.PermissionCode]int)
	for _, permission := range append(append([]repositories.PermissionDefinition{}, enforcedPermissions...), reservedPermissions...) {
		seen[permission.Codename]++
	}
	if len(declaredPermissions) != len(seen) {
		t.Fatalf("declaredPermissions holds %d entries against %d distinct codenames in the two lists", len(declaredPermissions), len(seen))
	}
	for _, permission := range declaredPermissions {
		switch seen[permission.Codename] {
		case 1:
		case 0:
			t.Errorf("%q is declared but appears in neither enforcedPermissions nor reservedPermissions", permission.Codename)
		default:
			t.Errorf("%q appears in both lists; it is either enforced or it is not", permission.Codename)
		}
	}
}

func TestSyncPermissionsAndSeedRoles_IsIdempotent(t *testing.T) {
	store := repositories.NewMemoryStore()
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("second sync: %v", err)
	}
}
