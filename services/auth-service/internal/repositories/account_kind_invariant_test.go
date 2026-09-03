package repositories

import (
	"context"
	"errors"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// S8-IDENTITY-003's repository-level invariant, and the sprint's Definition of
// Done line "an `end_user` account cannot hold a permission row, enforced at
// the repository level with a test".
//
// It is worth being precise about what this guards. Decision 1 put staff and
// end users in ONE `accounts` table, which bought every hardened primitive
// auth-service already has and cost exactly this: the separation between the
// two audiences is no longer a table boundary, so it has to be something else.
// The audience claim covers the token side (contracts.AudienceForAccountKind);
// this covers the permission side. Without it, one bad role assignment turns a
// product signup into staff access.
func TestAssignRoleRefusesAnEndUserAccount(t *testing.T) {
	store := NewMemoryStore()
	role, err := store.CreateRole(context.Background(), "analyst", "reads charts",
		contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	endUser, err := store.CreateAccount(context.Background(), CreateAccountParams{
		Email: "visitor@example.com", PasswordHash: "a-hash", Kind: contracts.AccountKindEndUser,
	})
	if err != nil {
		t.Fatalf("create end-user account: %v", err)
	}

	if err := store.AssignRole(context.Background(), endUser.ID, role.ID); !errors.Is(err, ErrRoleNotGrantableToAccountKind) {
		t.Fatalf("error = %v, want ErrRoleNotGrantableToAccountKind", err)
	}

	// And the refusal actually left no row behind, which is the assertion that
	// matters: an error return with the write already applied would look
	// identical to a caller and be exactly the state this forbids.
	roles, permissions, err := store.AccountRolesAndPermissions(context.Background(), endUser.ID)
	if err != nil {
		t.Fatalf("read roles and permissions: %v", err)
	}
	if len(roles) != 0 || len(permissions) != 0 {
		t.Fatalf("the end-user account holds roles=%v permissions=%v after a refused assignment", roles, permissions)
	}
}

// The same call must still work for staff, or the guard above has been written
// as "nobody may hold a role" and every admin screen is broken.
func TestAssignRoleStillWorksForAStaffAccount(t *testing.T) {
	store := NewMemoryStore()
	role, err := store.CreateRole(context.Background(), "analyst", "reads charts",
		contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	staff, err := store.CreateAccount(context.Background(), CreateAccountParams{
		Email: "staff@example.com", PasswordHash: "a-hash", Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		t.Fatalf("create staff account: %v", err)
	}

	if err := store.AssignRole(context.Background(), staff.ID, role.ID); err != nil {
		t.Fatalf("assign role to staff: %v", err)
	}
	_, permissions, err := store.AccountRolesAndPermissions(context.Background(), staff.ID)
	if err != nil {
		t.Fatalf("read roles and permissions: %v", err)
	}
	if len(permissions) == 0 {
		t.Fatal("a staff account holds no permission after a successful role assignment")
	}
}

// AssignRoleByName is only a test-seeding helper, which is precisely why it
// needs the same check: without it a test could seed the forbidden state and
// then assert against it, and the invariant above would be measuring a
// situation nothing in production can reach.
func TestAssignRoleByNameCannotSeedTheForbiddenState(t *testing.T) {
	store := NewMemoryStore()
	if _, err := store.CreateRole(context.Background(), "analyst", "reads charts",
		contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)}); err != nil {
		t.Fatalf("create role: %v", err)
	}
	endUser, err := store.CreateAccount(context.Background(), CreateAccountParams{
		Email: "visitor@example.com", PasswordHash: "a-hash", Kind: contracts.AccountKindEndUser,
	})
	if err != nil {
		t.Fatalf("create end-user account: %v", err)
	}

	store.AssignRoleByName(endUser.ID, "analyst")

	_, permissions, err := store.AccountRolesAndPermissions(context.Background(), endUser.ID)
	if err != nil {
		t.Fatalf("read roles and permissions: %v", err)
	}
	if len(permissions) != 0 {
		t.Fatalf("the seeding helper granted %v to an end-user account", permissions)
	}
}

// PostgresStore and MemoryStore must refuse identically, or every unit test in
// this repo runs against a store that permits what production forbids.
// PostgresStore needs a database and is exercised by the deploy path rather
// than here, so this reads its SQL and asserts the guard is present.
func TestThePostgresStoreCarriesTheSameKindGuard(t *testing.T) {
	source := readRepositorySource(t, "postgres_roles_permissions.go")
	if !containsAll(source, "func (store *PostgresStore) AssignRole", "ErrRoleNotGrantableToAccountKind", "AccountKindStaff") {
		t.Fatal("PostgresStore.AssignRole no longer checks the account kind; MemoryStore's guard would then be the only one and every test would pass against a store production does not use")
	}
}
