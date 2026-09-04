package repositories

import (
	"context"
	"errors"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	// ErrRoleNotGrantableToAccountKind refuses a role assignment to an account
	// that is not staff.
	//
	// This is the structural half of decision 1, enforced at the only layer
	// that can enforce it: one `accounts` table serves both audiences, so
	// "an end_user account holds no permission row" cannot be a convention
	// somebody remembers. Store is documented as the sole path to
	// myunivokai_auth and nothing outside this package touches SQL, which is
	// what makes a check here a boundary rather than a suggestion.
	//
	// The failure it prevents is specific and severe: an end-user account with
	// a role is staff access reachable through the product's own signup form.
	ErrRoleNotGrantableToAccountKind = errors.New("a role can only be granted to a staff account")
)

type Account struct {
	ID                  string
	Email               string
	Name                string
	PasswordHash        string
	Kind                contracts.AccountKind
	IsSuperAdmin        bool
	Disabled            bool
	TokenVersion        int
	FailedAttempts      int
	LockedUntil         *time.Time
	ForcePasswordChange bool
	// InvitedAt/InviteExpiresAt are only non-nil between CreateInvite and
	// AcceptInvite - see migrations/000002_invite_flow.sql. The invite
	// token itself is never exposed here, only its hash inside the store.
	InvitedAt       *time.Time
	InviteExpiresAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// AccountProfile is one row of account_profiles: what an account holder
// recorded about themselves, and the defaults their create-world form is
// filled from.
//
// There is no Nickname field, and the migration has no column for one. The
// nickname is Account.Name — see 000004_account_profiles.sql, and
// contracts.AccountProfileData, which projects it.
//
// Interests, Traits and FavoriteColors are never nil after a read: an absent
// row and an empty list are the same thing to every caller, and a nil slice
// would make the difference visible for no reason.
type AccountProfile struct {
	AccountID            string
	FullName             string
	Gender               contracts.AccountGender
	PreferredWorldFamily contracts.WorldFamily
	PreferredWorldStyle  string
	PrimaryRole          string
	Goal                 string
	Challenge            string
	Mood                 string
	Interests            []string
	Traits               []string
	FavoriteColors       []string
	AutofillCreateForm   bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// SystemSetting is one row of system_settings: an operator's override of a
// value contracts.DeclaredSettings already declares a default for.
//
// Key is a contracts.SettingKey rather than a string because the registry is
// the only thing that gives a row meaning — its type, its bounds and its
// default all come from there, and a plain string would make "is this key
// declared" a question a caller could forget to ask.
//
// UpdatedByAccountID is nil for a row whose actor's account has since been
// deleted; the column is ON DELETE SET NULL, so a policy number survives the
// staff member who set it. It is never nil on a row this service wrote.
type SystemSetting struct {
	Key                contracts.SettingKey
	Value              string
	UpdatedByAccountID *string
	UpdatedAt          time.Time
}

type RefreshToken struct {
	ID        string
	AccountID string
	FamilyID  string
	TokenHash string
	UsedAt    *time.Time
	RevokedAt *time.Time
	ExpiresAt time.Time
	CreatedAt time.Time
}

// PermissionDefinition is the Go-declared source of truth synced into the
// permissions table at startup. Staff read these; they never invent them -
// see agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
type PermissionDefinition struct {
	Codename    contracts.PermissionCode
	Description string
	Audience    contracts.AccountAudience
}

// ID and OccurredAt are populated only when reading back via ListAuditEvents
// (the database assigns both); RecordAuditEvent leaves them zero on write.
type AuditEvent struct {
	ID             string
	ActorAccountID *string
	Action         string
	Target         string
	Result         string
	SourceAddress  string
	OccurredAt     time.Time
}

type CreateAccountParams struct {
	Email               string
	Name                string
	PasswordHash        string
	Kind                contracts.AccountKind
	IsSuperAdmin        bool
	ForcePasswordChange bool
}

// InviteAccountParams creates an account with no password: PasswordHash on
// the resulting Account is empty until AcceptInvite sets it - see
// migrations/000002_invite_flow.sql's password-or-invite check constraint.
type InviteAccountParams struct {
	Email           string
	RoleIDs         []string
	InviteTokenHash string
	InviteExpiresAt time.Time
}

// Role is the half staff compose freely at runtime, unlike Permission which
// is Go-declared - see agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
type Role struct {
	ID                  string
	Name                string
	Description         string
	Audience            contracts.AccountAudience
	IsSystem            bool
	PermissionCodenames []string
}

type Permission struct {
	Codename    contracts.PermissionCode
	Description string
	Audience    contracts.AccountAudience
}

// Store is auth-service's persistence boundary. Every method here is the
// only path to myunivokai_auth; nothing outside this package touches SQL.
type Store interface {
	CreateAccount(ctx context.Context, params CreateAccountParams) (Account, error)
	// UpdateAccount changes email and name, the two fields an admin-created
	// account can have changed after the fact — see contracts.AccountUpdateData's
	// comment on why nothing else is editable through this path.
	UpdateAccount(ctx context.Context, accountID, email, name string) (Account, error)
	GetAccountByEmail(ctx context.Context, email string) (Account, error)
	GetAccountByID(ctx context.Context, accountID string) (Account, error)
	// ListAccounts's search, when non-empty, matches email or name
	// case-insensitively as a substring — see PostgresStore.ListAccounts. kind,
	// when non-empty, restricts the page to that account kind; empty means
	// every kind, so the filter is additive for callers that send nothing.
	ListAccounts(ctx context.Context, cursor string, pageSize int, search string, kind contracts.AccountKind) (accounts []Account, nextCursor string, err error)
	AccountRolesAndPermissions(ctx context.Context, accountID string) (roles []string, permissions []string, err error)
	CountSuperAdmins(ctx context.Context) (int, error)

	// GetAccountProfile returns ErrNotFound when the account has never saved
	// a profile. The service turns that into an empty profile rather than an
	// error - see AccountProfile in internal/services/account_profile_service.go
	// for why "not saved yet" must not read as a failure on a page whose whole
	// job is to be opened for the first time.
	GetAccountProfile(ctx context.Context, accountID string) (AccountProfile, error)
	// UpsertAccountProfile writes the profile whole, creating the row on first
	// save. Whole rather than field-by-field because the page sends every
	// field it renders: a merge would make a field somebody cleared
	// indistinguishable from one the request did not mention.
	UpsertAccountProfile(ctx context.Context, profile AccountProfile) (AccountProfile, error)
	// SetAccountDisplayName changes accounts.name and nothing else.
	//
	// Deliberately not UpdateAccount, which also takes an email: the account's
	// own page must not be a path to changing the address somebody signs in
	// with, and passing the current email back in to keep it unchanged would
	// make that one dropped field away from being exactly that.
	SetAccountDisplayName(ctx context.Context, accountID, name string) (Account, error)

	RecordFailedLoginAttempt(ctx context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error
	ResetFailedLoginAttempts(ctx context.Context, accountID string) error
	BumpTokenVersion(ctx context.Context, accountID string) (int, error)
	SetAccountDisabled(ctx context.Context, accountID string, disabled bool) error

	CreateRefreshToken(ctx context.Context, token RefreshToken) error
	GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error)
	MarkRefreshTokenUsed(ctx context.Context, tokenID string) error
	RevokeRefreshTokenFamily(ctx context.Context, familyID string) error
	RevokeAllRefreshTokensForAccount(ctx context.Context, accountID string) error

	SyncPermissions(ctx context.Context, definitions []PermissionDefinition) error
	EnsureSystemRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error

	// CreateInvite, GetAccountByInviteTokenHash and AcceptInvite implement the
	// invite flow: an account row exists with no password from the moment it
	// is invited, identified only by the hash of a one-time token - see
	// migrations/000002_invite_flow.sql.
	CreateInvite(ctx context.Context, params InviteAccountParams) (Account, error)
	GetAccountByInviteTokenHash(ctx context.Context, tokenHash string) (Account, error)
	AcceptInvite(ctx context.Context, accountID, passwordHash string) (Account, error)

	ListRoles(ctx context.Context) ([]Role, error)
	GetRoleByID(ctx context.Context, roleID string) (Role, error)
	CreateRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) (Role, error)
	UpdateRole(ctx context.Context, roleID, description string, permissionCodenames []string) (Role, error)
	DeleteRole(ctx context.Context, roleID string) error
	CountAccountsWithRole(ctx context.Context, roleID string) (int, error)
	// AssignRole returns ErrRoleNotGrantableToAccountKind for any account
	// whose kind is not staff - see that error for why the check lives here.
	AssignRole(ctx context.Context, accountID, roleID string) error
	RevokeRole(ctx context.Context, accountID, roleID string) error
	// AccountPermissionsExcludingRole computes what an account's permission
	// set WOULD be if roleID were revoked, without revoking it - the read
	// RevokeRole's self-revoke guard needs before deciding whether the write
	// is allowed. See agent-system/plans/services/auth-and-admin-plan.md#lockout-guards--enforced-server-side-not-in-the-ui.
	AccountPermissionsExcludingRole(ctx context.Context, accountID, excludeRoleID string) ([]string, error)

	// The settings control plane. ListSystemSettings returns orphan rows too
	// and GetSystemSetting answers ErrNotFound for a key with no row, which is
	// the normal case: every setting has a compiled-in default, and a fresh
	// environment has an empty table by design.
	ListSystemSettings(ctx context.Context) ([]SystemSetting, error)
	GetSystemSetting(ctx context.Context, key contracts.SettingKey) (SystemSetting, error)
	// UpsertSystemSetting reports the value it replaced, for the audit line
	// `<key>: <old> -> <new>`. An empty previous value means there was no row,
	// so what was replaced is the compiled-in default.
	UpsertSystemSetting(ctx context.Context, key contracts.SettingKey, value, actorAccountID string) (previousValue string, err error)

	ListPermissions(ctx context.Context) ([]Permission, error)
	ListAuditEvents(ctx context.Context, cursor string, pageSize int, since, until *time.Time, search string) (events []AuditEvent, nextCursor string, totalCount int, err error)

	RecordAuditEvent(ctx context.Context, event AuditEvent) error
}
