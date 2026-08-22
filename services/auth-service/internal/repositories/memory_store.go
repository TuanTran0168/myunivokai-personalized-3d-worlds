package repositories

import (
	"sync"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

type memoryRole struct {
	id                  string
	name                string
	description         string
	audience            contracts.AccountAudience
	isSystem            bool
	permissionCodenames map[string]struct{}
}

// MemoryStore is a real in-process implementation of Store, not a mock —
// the same convention universe-service's MemoryStore follows. It backs
// AuthService's tests so the business logic (lockout, refresh rotation,
// reuse detection) is exercised without a database. Split across this file
// and memory_accounts.go / memory_refresh_tokens.go /
// memory_roles_permissions.go / memory_audit.go for the same reason
// PostgresStore is — see postgres_store.go's package comment.
type MemoryStore struct {
	mu                         sync.RWMutex
	accountsByID               map[string]Account
	accountIDByEmail           map[string]string
	accountIDByInviteTokenHash map[string]string
	permissions                map[string]PermissionDefinition
	roles                      map[string]*memoryRole
	roleIDByName               map[string]string
	accountRoleIDs             map[string]map[string]struct{}
	refreshTokensByID          map[string]RefreshToken
	refreshTokenIDByHash       map[string]string
	auditEvents                []AuditEvent
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		accountsByID:               map[string]Account{},
		accountIDByEmail:           map[string]string{},
		accountIDByInviteTokenHash: map[string]string{},
		permissions:                map[string]PermissionDefinition{},
		roles:                      map[string]*memoryRole{},
		roleIDByName:               map[string]string{},
		accountRoleIDs:             map[string]map[string]struct{}{},
		refreshTokensByID:          map[string]RefreshToken{},
		refreshTokenIDByHash:       map[string]string{},
	}
}
