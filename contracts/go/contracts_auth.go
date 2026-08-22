package contracts

import "time"

const (
	AuthLoginQuerySubject          = "myunivokai.queries.auth.login.v1"
	AuthRefreshQuerySubject        = "myunivokai.queries.auth.refresh.v1"
	AuthLogoutQuerySubject         = "myunivokai.queries.auth.logout.v1"
	AuthTokenVersionQuerySubject   = "myunivokai.queries.auth.tokenversion.get.v1"
	AuthAccountListQuerySubject    = "myunivokai.queries.auth.account.list.v1"
	AuthAccountGetQuerySubject     = "myunivokai.queries.auth.account.get.v1"
	AuthAccountDisableQuerySubject = "myunivokai.queries.auth.account.disable.v1"
	AuthAccountEnableQuerySubject  = "myunivokai.queries.auth.account.enable.v1"
	AuthRoleListQuerySubject       = "myunivokai.queries.auth.role.list.v1"
	AuthRoleCreateQuerySubject     = "myunivokai.queries.auth.role.create.v1"
	AuthRoleUpdateQuerySubject     = "myunivokai.queries.auth.role.update.v1"
	AuthRoleDeleteQuerySubject     = "myunivokai.queries.auth.role.delete.v1"
	AuthRoleAssignQuerySubject     = "myunivokai.queries.auth.role.assign.v1"
	AuthRoleRevokeQuerySubject     = "myunivokai.queries.auth.role.revoke.v1"
	AuthPermissionListQuerySubject = "myunivokai.queries.auth.permission.list.v1"
	AuthAuditListQuerySubject      = "myunivokai.queries.auth.audit.list.v1"
	AuthInviteCreateQuerySubject   = "myunivokai.queries.auth.invite.create.v1"
	AuthInviteAcceptQuerySubject   = "myunivokai.queries.auth.invite.accept.v1"
	AuthAccountCreateQuerySubject  = "myunivokai.queries.auth.account.create.v1"
	AuthAccountUpdateQuerySubject  = "myunivokai.queries.auth.account.update.v1"
	// AuthAccountPermissionsQuerySubject answers the gateway's permission
	// check for management routes (RequireAdminPermission) — a fresh lookup
	// per request rather than a cache, since admin-management traffic is low
	// volume staff usage, not the hot path S4-AUTH-003's tokenVersion cache
	// exists for. See services/api-gateway/internal/middleware/admin_permission.go.
	AuthAccountPermissionsQuerySubject = "myunivokai.queries.auth.account.permissions.get.v1"

	AccountAudienceAdmin AccountAudience = "admin"
	AccountAudienceWeb   AccountAudience = "web"

	AccountKindStaff   AccountKind = "staff"
	AccountKindEndUser AccountKind = "end_user"

	PermissionWorldRead      PermissionCode = "world:read"
	PermissionWorldUnpublish PermissionCode = "world:unpublish"
	PermissionVariantRead    PermissionCode = "variant:read"
	PermissionJobRead        PermissionCode = "job:read"
	PermissionJobRetry       PermissionCode = "job:retry"
	PermissionProfileRead    PermissionCode = "profile:read"
	PermissionProfileReveal  PermissionCode = "profile:reveal"
	PermissionChartRead      PermissionCode = "chart:read"
	PermissionAccountRead    PermissionCode = "account:read"
	PermissionAccountManage  PermissionCode = "account:manage"
	PermissionAuditRead      PermissionCode = "audit:read"
	PermissionRoleRead       PermissionCode = "role:read"
	PermissionRoleManage     PermissionCode = "role:manage"
)

// AccountAudience matches the audience claim on an access token. A role or
// permission scoped to one audience can never be granted on a token minted
// for the other, enforced at the same place the token's signature is
// verified — see notes/vision/auth-and-admin-plan.md#rbac.
type AccountAudience string

func (audience AccountAudience) Valid() bool {
	return audience == AccountAudienceAdmin || audience == AccountAudienceWeb
}

// AccountKind is a column value, not an authorization decision. It exists so
// the schema does not need to change when end-user accounts are approved —
// see notes/vision/auth-and-admin-plan.md#why-this-does-not-violate-deferred-auth-001.
type AccountKind string

// PermissionCode is declared in Go and synced into the permissions table at
// migration/startup; staff read these, they never invent them. Roles are the
// part staff compose freely — see
// notes/vision/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
type PermissionCode string

// AccessTokenClaims is the decoded shape of the short-lived Ed25519 access
// JWT. TokenVersion is compared against the Redis-cached value auth-service
// writes on disable or password change; a claim below the stored value means
// revoked — see notes/vision/auth-and-admin-plan.md#how-b-works.
type AccessTokenClaims struct {
	Subject      string          `json:"subject"`
	Roles        []string        `json:"roles"`
	Audience     AccountAudience `json:"audience"`
	TokenVersion int             `json:"tokenVersion"`
	ExpiresAt    time.Time       `json:"expiresAt"`
}

type AccountSummary struct {
	AccountID           string      `json:"accountId"`
	Email               string      `json:"email"`
	Name                string      `json:"name,omitempty"`
	Kind                AccountKind `json:"kind"`
	Roles               []string    `json:"roles"`
	Permissions         []string    `json:"permissions"`
	IsSuperAdmin        bool        `json:"isSuperAdmin"`
	Disabled            bool        `json:"disabled"`
	ForcePasswordChange bool        `json:"forcePasswordChange"`
	CreatedAt           time.Time   `json:"createdAt"`
}

type RoleSummary struct {
	RoleID      string          `json:"roleId"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Audience    AccountAudience `json:"audience"`
	IsSystem    bool            `json:"isSystem"`
	Permissions []string        `json:"permissions"`
}

type PermissionSummary struct {
	Codename    PermissionCode  `json:"codename"`
	Description string          `json:"description"`
	Audience    AccountAudience `json:"audience"`
}

type AuditEventSummary struct {
	AuditEventID   string    `json:"auditEventId"`
	ActorAccountID string    `json:"actorAccountId"`
	Action         string    `json:"action"`
	Target         string    `json:"target,omitempty"`
	Result         string    `json:"result"`
	SourceAddress  string    `json:"sourceAddress"`
	OccurredAt     time.Time `json:"occurredAt"`
}

// LoginData carries the credential pair auth-service verifies with Argon2id.
// Password policy is enforced there, not here — this type only fixes the
// wire shape between the gateway and auth-service. SourceAddress is carried
// here, not derived by auth-service, because the gateway is the only
// component that ever terminates the HTTP connection and therefore the only
// one that knows the caller's address — NATS request/reply does not expose
// it to the responder.
type LoginData struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	SourceAddress string `json:"sourceAddress"`
}

// LoginResponseData is returned by both login and refresh: a refresh always
// rotates and returns a full new pair, never only the access token.
type LoginResponseData struct {
	AccessToken      string         `json:"accessToken"`
	AccessExpiresAt  time.Time      `json:"accessExpiresAt"`
	RefreshToken     string         `json:"refreshToken"`
	RefreshExpiresAt time.Time      `json:"refreshExpiresAt"`
	Account          AccountSummary `json:"account"`
}

type RefreshData struct {
	RefreshToken  string `json:"refreshToken"`
	SourceAddress string `json:"sourceAddress"`
}

type LogoutData struct {
	RefreshToken  string `json:"refreshToken"`
	SourceAddress string `json:"sourceAddress"`
}

type TokenVersionQueryData struct {
	AccountID string `json:"accountId"`
}

type TokenVersionResponseData struct {
	TokenVersion int `json:"tokenVersion"`
}

// PageQueryData is shared by every cursor-paginated auth query. Filters, if
// any query needs one, are additive fields on the specific query's own data
// type, not on this shared shape.
type PageQueryData struct {
	Cursor   string `json:"cursor,omitempty"`
	PageSize int    `json:"pageSize"`
}

type AccountListResponseData struct {
	Accounts   []AccountSummary `json:"accounts"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

// AccountListQueryData embeds PageQueryData for the same reason
// AuditListQueryData does. Search matches an account's email or name — see
// Store.ListAccounts for the exact ILIKE columns.
type AccountListQueryData struct {
	PageQueryData
	Search string `json:"search,omitempty"`
}

type AccountGetQueryData struct {
	AccountID string `json:"accountId"`
}

// AccountDisableData and AccountEnableData carry ActorAccountID and
// SourceAddress for the same reason LoginData does: auth-service's audit
// row needs to name who performed the action, and only the gateway (which
// already verified the actor's own token) knows that.
type AccountDisableData struct {
	AccountID      string `json:"accountId"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type AccountEnableData struct {
	AccountID      string `json:"accountId"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type RoleListResponseData struct {
	Roles      []RoleSummary `json:"roles"`
	NextCursor string        `json:"nextCursor,omitempty"`
}

// ActorAccountID and SourceAddress were added to every role mutation below
// at implementation time (S4-AUTH-005): the gateway is the only component
// that knows either, same reason AccountDisableData/AccountEnableData
// already carry them, and no consumer existed yet to break by adding them.
type RoleCreateData struct {
	Name           string          `json:"name"`
	Description    string          `json:"description,omitempty"`
	Audience       AccountAudience `json:"audience"`
	Permissions    []string        `json:"permissions"`
	ActorAccountID string          `json:"actorAccountId"`
	SourceAddress  string          `json:"sourceAddress"`
}

type RoleUpdateData struct {
	RoleID         string   `json:"roleId"`
	Description    string   `json:"description,omitempty"`
	Permissions    []string `json:"permissions"`
	ActorAccountID string   `json:"actorAccountId"`
	SourceAddress  string   `json:"sourceAddress"`
}

type RoleDeleteData struct {
	RoleID         string `json:"roleId"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type RoleAssignData struct {
	AccountID      string `json:"accountId"`
	RoleID         string `json:"roleId"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type RoleRevokeData struct {
	AccountID      string `json:"accountId"`
	RoleID         string `json:"roleId"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type PermissionListResponseData struct {
	Permissions []PermissionSummary `json:"permissions"`
}

// AuditListQueryData embeds PageQueryData for the same reason the analytics
// list queries do: pagination is one shared shape, and Since/Until are
// additive fields on this specific query. Both are pointers so "no bound"
// stays distinguishable from a bound at the zero time.
type AuditListQueryData struct {
	PageQueryData
	Since  *time.Time `json:"since,omitempty"`
	Until  *time.Time `json:"until,omitempty"`
	Search string     `json:"search,omitempty"`
}

type AuditListResponseData struct {
	Events     []AuditEventSummary `json:"events"`
	NextCursor string              `json:"nextCursor,omitempty"`
	TotalCount int                 `json:"totalCount"`
}

// InviteCreateData creates an account with no password, identified only by
// a one-time token the operator relays out of band — no email infrastructure
// exists yet, so the token is returned once in InviteCreateResponseData and
// never stored anywhere but its hash.
type InviteCreateData struct {
	Email          string   `json:"email"`
	RoleIDs        []string `json:"roleIds"`
	ActorAccountID string   `json:"actorAccountId"`
	SourceAddress  string   `json:"sourceAddress"`
}

type InviteCreateResponseData struct {
	AccountID       string    `json:"accountId"`
	InviteToken     string    `json:"inviteToken"`
	InviteExpiresAt time.Time `json:"inviteExpiresAt"`
}

// InviteAcceptData sets the invited account's first password. The response
// is a LoginResponseData: accepting an invite logs the account in, the same
// way a normal login would.
type InviteAcceptData struct {
	InviteToken   string `json:"inviteToken"`
	Password      string `json:"password"`
	SourceAddress string `json:"sourceAddress"`
}

// AccountCreateData creates a staff account with a password the actor
// chooses right away — no email infrastructure exists to relay a token (see
// InviteCreateData), and building one is deliberately deferred; see
// notes/vision/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
// Unlike an invite, the account is active from the moment it is created.
type AccountCreateData struct {
	Email          string   `json:"email"`
	Name           string   `json:"name,omitempty"`
	Password       string   `json:"password"`
	RoleIDs        []string `json:"roleIds,omitempty"`
	ActorAccountID string   `json:"actorAccountId"`
	SourceAddress  string   `json:"sourceAddress"`
}

// AccountUpdateData changes an existing account's email and/or display name.
// Role membership is managed separately via RoleAssignData/RoleRevokeData,
// and there is deliberately nothing else editable through this path — kind,
// isSuperAdmin and disabled each already have their own dedicated, audited
// path.
type AccountUpdateData struct {
	AccountID      string `json:"accountId"`
	Email          string `json:"email"`
	Name           string `json:"name,omitempty"`
	ActorAccountID string `json:"actorAccountId"`
	SourceAddress  string `json:"sourceAddress"`
}

type AccountPermissionsQueryData struct {
	AccountID string `json:"accountId"`
}

type AccountPermissionsResponseData struct {
	Permissions  []string `json:"permissions"`
	IsSuperAdmin bool     `json:"isSuperAdmin"`
}
