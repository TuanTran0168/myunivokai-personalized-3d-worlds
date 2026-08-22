package repositories

import (
	"context"
	"sort"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func (store *MemoryStore) SyncPermissions(_ context.Context, definitions []PermissionDefinition) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	known := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		store.permissions[string(definition.Codename)] = definition
		known[string(definition.Codename)] = struct{}{}
	}
	for codename := range store.permissions {
		if _, stillDeclared := known[codename]; !stillDeclared {
			delete(store.permissions, codename)
		}
	}
	return nil
}

func (store *MemoryStore) EnsureSystemRole(_ context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	roleID, exists := store.roleIDByName[name]
	if !exists {
		roleID = uuid.NewString()
		store.roleIDByName[name] = roleID
	}
	codenameSet := make(map[string]struct{}, len(permissionCodenames))
	for _, codename := range permissionCodenames {
		codenameSet[codename] = struct{}{}
	}
	store.roles[roleID] = &memoryRole{
		id: roleID, name: name, description: description, audience: audience, isSystem: true, permissionCodenames: codenameSet,
	}
	return nil
}

// AssignRoleByName is a test/bootstrap convenience for seeding a role
// assignment by name; production code always has a roleID (from ListRoles
// or CreateRole) and uses AssignRole below instead.
func (store *MemoryStore) AssignRoleByName(accountID, roleName string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	roleID, found := store.roleIDByName[roleName]
	if !found {
		return
	}
	if store.accountRoleIDs[accountID] == nil {
		store.accountRoleIDs[accountID] = map[string]struct{}{}
	}
	store.accountRoleIDs[accountID][roleID] = struct{}{}
}

func toRole(memRole *memoryRole) Role {
	codenames := make([]string, 0, len(memRole.permissionCodenames))
	for codename := range memRole.permissionCodenames {
		codenames = append(codenames, codename)
	}
	sort.Strings(codenames)
	return Role{
		ID: memRole.id, Name: memRole.name, Description: memRole.description,
		Audience: memRole.audience, IsSystem: memRole.isSystem, PermissionCodenames: codenames,
	}
}

func (store *MemoryStore) ListRoles(_ context.Context) ([]Role, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	roles := make([]Role, 0, len(store.roles))
	for _, memRole := range store.roles {
		roles = append(roles, toRole(memRole))
	}
	sort.Slice(roles, func(i, j int) bool { return roles[i].Name < roles[j].Name })
	return roles, nil
}

func (store *MemoryStore) GetRoleByID(_ context.Context, roleID string) (Role, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	memRole, found := store.roles[roleID]
	if !found {
		return Role{}, ErrNotFound
	}
	return toRole(memRole), nil
}

// CreateRole never creates a system role, matching PostgresStore's CreateRole.
func (store *MemoryStore) CreateRole(_ context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) (Role, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.roleIDByName[name]; exists {
		return Role{}, ErrConflict
	}
	roleID := uuid.NewString()
	store.roleIDByName[name] = roleID
	codenameSet := make(map[string]struct{}, len(permissionCodenames))
	for _, codename := range permissionCodenames {
		codenameSet[codename] = struct{}{}
	}
	memRole := &memoryRole{id: roleID, name: name, description: description, audience: audience, isSystem: false, permissionCodenames: codenameSet}
	store.roles[roleID] = memRole
	return toRole(memRole), nil
}

func (store *MemoryStore) UpdateRole(_ context.Context, roleID, description string, permissionCodenames []string) (Role, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	memRole, found := store.roles[roleID]
	if !found {
		return Role{}, ErrNotFound
	}
	codenameSet := make(map[string]struct{}, len(permissionCodenames))
	for _, codename := range permissionCodenames {
		codenameSet[codename] = struct{}{}
	}
	memRole.description = description
	memRole.permissionCodenames = codenameSet
	return toRole(memRole), nil
}

func (store *MemoryStore) DeleteRole(_ context.Context, roleID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	memRole, found := store.roles[roleID]
	if !found {
		return ErrNotFound
	}
	delete(store.roles, roleID)
	delete(store.roleIDByName, memRole.name)
	for accountID := range store.accountRoleIDs {
		delete(store.accountRoleIDs[accountID], roleID)
	}
	return nil
}

func (store *MemoryStore) CountAccountsWithRole(_ context.Context, roleID string) (int, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	count := 0
	for _, roleIDs := range store.accountRoleIDs {
		if _, held := roleIDs[roleID]; held {
			count++
		}
	}
	return count, nil
}

func (store *MemoryStore) AssignRole(_ context.Context, accountID, roleID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, found := store.roles[roleID]; !found {
		return ErrNotFound
	}
	if store.accountRoleIDs[accountID] == nil {
		store.accountRoleIDs[accountID] = map[string]struct{}{}
	}
	store.accountRoleIDs[accountID][roleID] = struct{}{}
	return nil
}

func (store *MemoryStore) RevokeRole(_ context.Context, accountID, roleID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.accountRoleIDs[accountID], roleID)
	return nil
}

func (store *MemoryStore) AccountPermissionsExcludingRole(_ context.Context, accountID, excludeRoleID string) ([]string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	permissionSet := map[string]struct{}{}
	for roleID := range store.accountRoleIDs[accountID] {
		if roleID == excludeRoleID {
			continue
		}
		memRole, found := store.roles[roleID]
		if !found {
			continue
		}
		for codename := range memRole.permissionCodenames {
			permissionSet[codename] = struct{}{}
		}
	}
	permissions := make([]string, 0, len(permissionSet))
	for codename := range permissionSet {
		permissions = append(permissions, codename)
	}
	return permissions, nil
}

func (store *MemoryStore) ListPermissions(_ context.Context) ([]Permission, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	permissions := make([]Permission, 0, len(store.permissions))
	for _, definition := range store.permissions {
		permissions = append(permissions, Permission{Codename: definition.Codename, Description: definition.Description, Audience: definition.Audience})
	}
	sort.Slice(permissions, func(i, j int) bool { return permissions[i].Codename < permissions[j].Codename })
	return permissions, nil
}
