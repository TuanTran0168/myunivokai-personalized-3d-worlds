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

	// The four product-audience subjects. They are separate from the four
	// unprefixed ones above rather than carrying an audience field in the
	// request, because decision 1 of
	// agent-system/plans/architecture/end-user-identity-and-ownership.md requires the
	// staff/end-user separation to be structural: a subject a caller cannot
	// publish is a stronger boundary than a field a caller could set, and the
	// NATS ACL can police it per subject.
	//
	// The four above therefore mean the ADMIN flow, and their names do not say
	// so. Renaming them to `auth.admin.*` would be correct and is deliberately
	// not done: they are deployed subjects with a live publisher and a live
	// subscriber, so the rename costs a coordinated two-service deploy plus a
	// NATS ACL change to buy clarity that this comment buys for nothing. Same
	// call, and same reason, as §17's decision not to rename `aud=web`.
	AuthWebSignupQuerySubject  = "myunivokai.queries.auth.web.signup.v1"
	AuthWebLoginQuerySubject   = "myunivokai.queries.auth.web.login.v1"
	AuthWebRefreshQuerySubject = "myunivokai.queries.auth.web.refresh.v1"
	AuthWebLogoutQuerySubject  = "myunivokai.queries.auth.web.logout.v1"

	// The account's own page. Product audience only, like the four above: a
	// staff account has no creation defaults to hold, and the admin surface
	// reads an account through AuthAccountGetQuerySubject.
	//
	// The account id on both requests is set by the gateway from the access
	// token's subject and is NEVER read from the request body — see
	// AccountProfileGetData. That is what makes "my profile" mean mine.
	AuthWebProfileGetQuerySubject    = "myunivokai.queries.auth.web.profile.get.v1"
	AuthWebProfileUpdateQuerySubject = "myunivokai.queries.auth.web.profile.update.v1"

	// The settings control plane. Admin audience only, and deliberately the
	// ONLY way a setting is written: the gateway's own settings reader is
	// read-only and answers a Redis miss from the compiled-in default rather
	// than by asking anything, so these two subjects carry every write and no
	// read on the create path — see §9.3 of
	// agent-system/plans/architecture/end-user-identity-and-ownership.md.
	AuthSettingListQuerySubject   = "myunivokai.queries.auth.setting.list.v1"
	AuthSettingUpdateQuerySubject = "myunivokai.queries.auth.setting.update.v1"

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
	// The settings screen's pair. Enforced by a route from the day they are
	// declared, unlike the five reserved codenames in auth-service's
	// permission_sync.go — which is why they belong in enforcedPermissions and
	// not beside those.
	//
	// Two codes rather than one because reading a policy number and changing
	// it are genuinely different acts: settings:read is a dashboard, and
	// settings:manage can shorten every session on the platform from a web
	// form.
	PermissionSettingsRead   PermissionCode = "settings:read"
	PermissionSettingsManage PermissionCode = "settings:manage"

	// MaximumAccountDisplayNameLength bounds WebSignupData.Name, and therefore
	// accounts.name for a self-registered account.
	//
	// It is DEFINED AS the create-world form's Nickname cap rather than as its
	// own 32, because the display name is what that field is auto-filled with
	// for a signed-in visitor. Two independent numbers that happen to agree
	// would let an account carry a name the create form then silently
	// truncates; this way they cannot disagree.
	//
	// It lives in contracts rather than in auth-service because the gateway
	// validates against it at the edge and cannot import another service's
	// internal package. Counted in RUNES wherever it is enforced: a byte
	// ceiling would admit 32 characters in one alphabet and refuse 32 in
	// another, and Vietnamese spends up to three bytes on one letter.
	MaximumAccountDisplayNameLength = maximumNicknameCharacters

	// MaximumFullNameLength bounds AccountProfileData.FullName. Longer than
	// the display name because it holds a full name rather than a handle, and
	// plenty of real names in full — with diacritics, particles and more than
	// two given names — pass 32 characters.
	MaximumFullNameLength = 120

	// The gender vocabulary AccountProfileData.Gender admits. A closed set
	// rather than free text, so the value can be rendered in the visitor's own
	// language on the client instead of being stored in whichever one they
	// typed — and GenderUnspecified is the default, which is why an unanswered
	// profile is a complete one.
	//
	// GenderPreferNotToSay is deliberately distinct from GenderUnspecified: one
	// is an answer and the other is the absence of one, and collapsing them
	// would make "I would rather not say" indistinguishable from "I have not
	// opened this page yet".
	GenderUnspecified    AccountGender = ""
	GenderFemale         AccountGender = "female"
	GenderMale           AccountGender = "male"
	GenderNonBinary      AccountGender = "non_binary"
	GenderOther          AccountGender = "other"
	GenderPreferNotToSay AccountGender = "prefer_not_to_say"
)

// AccountGender is display data an account holder sets about themselves.
// Nothing reads it to decide anything, and it is never inferred: an
// unanswered profile stores GenderUnspecified and stays that way.
type AccountGender string

func (gender AccountGender) Valid() bool {
	switch gender {
	case GenderUnspecified, GenderFemale, GenderMale, GenderNonBinary, GenderOther, GenderPreferNotToSay:
		return true
	default:
		return false
	}
}

// AccountProfileData is the account's own page: who they are, and the
// defaults the create-world form is filled from.
//
// CreationDefaults is a WorldInput — the very type the generate command
// carries — rather than a parallel struct listing the same nine fields. That
// is the point: a profile that could not express the form it fills would drift
// from it the first time the form gained a field.
//
// It is a DRAFT of a WorldInput, though, and never validated as a submission.
// See WorldInput.ValidateAsCreationDefaults for why the difference matters:
// a half-filled profile is a legitimate thing to save, and a complete world is
// not a legitimate thing to demand before somebody can record their own name.
//
// CreationDefaults.Nickname is not stored in account_profiles at all: it is
// projected from accounts.name on read and written back to accounts.name on
// update, so an account has exactly ONE name — the one in the header menu is
// the one the create form is filled with.
type AccountProfileData struct {
	FullName             string        `json:"fullName,omitempty"`
	Gender               AccountGender `json:"gender,omitempty"`
	PreferredWorldFamily WorldFamily   `json:"preferredWorldFamily,omitempty"`
	CreationDefaults     WorldInput    `json:"creationDefaults"`

	// AutofillCreateForm is the create page's toggle, stored on the account so
	// it follows the person to their next device rather than living in one
	// browser. It governs the world-preference fields only; the display name
	// fills the Nickname field either way, because a name is not a preference
	// somebody has to opt into being called by.
	AutofillCreateForm bool `json:"autofillCreateForm"`

	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

// AccountProfileGetData carries only the account id, and the gateway sets it
// from the access token's subject. There is deliberately no other field: an
// account id a caller could name is an account id a caller could name
// somebody else's.
type AccountProfileGetData struct {
	AccountID string `json:"accountId"`
}

// AccountProfileUpdateData replaces the account's profile wholesale — the
// page sends every field it renders, so a partial merge would make an
// emptied field indistinguishable from an omitted one.
//
// AccountID is set by the gateway from the token, exactly as in
// AccountProfileGetData. SourceAddress is carried for the audit row, the same
// way every other mutation in this file carries it.
type AccountProfileUpdateData struct {
	AccountID string        `json:"accountId"`
	FullName  string        `json:"fullName,omitempty"`
	Gender    AccountGender `json:"gender,omitempty"`
	// DisplayName writes accounts.name. Named for what it is rather than
	// `name`, because AccountProfileData projects it into
	// CreationDefaults.Nickname and a reader of this struct needs to know
	// which of the two they are setting: there is only one.
	DisplayName          string      `json:"displayName,omitempty"`
	PreferredWorldFamily WorldFamily `json:"preferredWorldFamily,omitempty"`
	CreationDefaults     WorldInput  `json:"creationDefaults"`
	AutofillCreateForm   bool        `json:"autofillCreateForm"`
	SourceAddress        string      `json:"sourceAddress"`
}

// AccountAudience matches the audience claim on an access token. A role or
// permission scoped to one audience can never be granted on a token minted
// for the other, enforced at the same place the token's signature is
// verified — see agent-system/plans/services/auth-and-admin-plan.md#rbac.
type AccountAudience string

func (audience AccountAudience) Valid() bool {
	return audience == AccountAudienceAdmin || audience == AccountAudienceWeb
}

// AccountKind is a column value, not an authorization decision. It exists so
// the schema does not need to change when end-user accounts are approved —
// see agent-system/plans/services/auth-and-admin-plan.md#why-this-does-not-violate-deferred-auth-001.
type AccountKind string

// AudienceForAccountKind is the only rule that decides which audience an
// access token is minted for, and it reads the account's own column rather
// than the endpoint the caller reached or a field in the request.
//
// That is the point. One `accounts` table serves both audiences (decision 1),
// so the separation has to be structural, and an audience derived from stored
// state cannot be asked for: a `staff` account can never obtain a `web` token
// and an `end_user` account can never obtain an `admin` one, whichever login
// flow, subject or refresh path it arrives through. The alternative — letting
// the caller name the audience — would mean a single spoofable field standing
// between an end-user account and the admin edge.
//
// The consequence, stated because it is a real one: a staff member cannot use
// their staff account in the product app, and needs a separate end-user
// account to do so. That is the correct posture for two audiences sharing a
// table, not a limitation to work around.
func AudienceForAccountKind(kind AccountKind) AccountAudience {
	if kind == AccountKindEndUser {
		return AccountAudienceWeb
	}
	return AccountAudienceAdmin
}

// PermissionCode is declared in Go and synced into the permissions table at
// migration/startup; staff read these, they never invent them. Roles are the
// part staff compose freely — see
// agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
type PermissionCode string

// AccessTokenClaims is the decoded shape of the short-lived Ed25519 access
// JWT. TokenVersion is compared against the Redis-cached value auth-service
// writes on disable or password change; a claim below the stored value means
// revoked — see agent-system/plans/services/auth-and-admin-plan.md#how-b-works.
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

// WebSignupData registers an end-user account: an email address stored
// unverified, and a password. Nothing is mailed, so nothing waits on mail
// infrastructure — see the plan's §5 and decision 11, and the two costs that
// decision accepts (no password reset, and no trust may attach to the
// address).
//
// There is no Kind field, and there must never be one: the account is created
// with AccountKindEndUser by the handler, and AudienceForAccountKind then
// decides the audience from it. A caller that could name either would be able
// to ask for staff.
//
// Name is the display name the person chose for themselves, and it is
// display data only: nothing authorizes on it, it is not unique, and it is
// not verified. It reaches accounts.name, which migration
// 000003_account_name.sql already added for staff accounts — so an end user
// having one costs no schema change.
type WebSignupData struct {
	Email         string `json:"email"`
	Name          string `json:"name,omitempty"`
	Password      string `json:"password"`
	SourceAddress string `json:"sourceAddress"`
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
//
// Kind filters by audience, and it is a SERVER-side filter rather than
// something the admin app could do to the page it received. That distinction
// is the whole reason the field exists: this list is cursor-paginated, so a
// client-side "end users only" filter would filter one page and report "no
// results" whenever the first twenty rows happened to be staff. An empty Kind
// means every kind, so an existing caller that sends nothing is unaffected.
type AccountListQueryData struct {
	PageQueryData
	Search string      `json:"search,omitempty"`
	Kind   AccountKind `json:"kind,omitempty"`
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
// agent-system/plans/services/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
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
