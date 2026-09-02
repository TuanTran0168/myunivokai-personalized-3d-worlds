package services

import (
	"context"
	"errors"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/rs/zerolog/log"
)

var (
	// ErrProfileInvalid rejects a profile that breaks a ceiling or names a
	// value outside a contracts vocabulary.
	//
	// It carries no per-field detail, and that is deliberate: the GATEWAY
	// validates this request field by field and answers with
	// contracts.ValidationDetail entries, exactly as it already does for the
	// generate call in world_handler.go. This error is the invariant behind
	// that check, for the case where something publishes the subject directly
	// — and an invariant does not need to be helpful, it needs to hold.
	ErrProfileInvalid = errors.New("that profile is not valid")

	// ErrProfileNotForStaff refuses a profile on a staff account.
	//
	// account_profiles holds creation defaults for the product's own create
	// form, which no staff account reaches: decision 1 gives a staff account
	// an `admin` token and the product edge refuses one. A staff profile would
	// be a row nothing could ever read, and the subject is product-audience
	// only, so reaching here with a staff account means something has gone
	// wrong upstream rather than that a feature is missing.
	ErrProfileNotForStaff = errors.New("a staff account has no product profile")
)

// auditActionProfileUpdate records an account editing its own page. Worth an
// audit row despite being self-service: accounts.name is what the header menu
// greets somebody by and what a shared world will eventually be attributed
// to, so "who changed this name, and when" is a question that gets asked.
const auditActionProfileUpdate = "profile_update"

// The account's own page. Methods hang off AuthService in a file of their
// own, which is this package's existing shape - role_management_service.go
// does the same, for the reason postgres_store.go's package comment gives: a
// second service struct would need its own path through NewRuntime and
// NewNATSHandler, and would buy nothing, since it needs exactly the store and
// the audit writer AuthService already holds.
//
// Nothing here is a credential path: no password is verified, no token is
// minted and no lockout applies.

// AccountProfile reads the account's page.
//
// An account with no saved profile gets an EMPTY one rather than a 404, and
// that is the one decision in this file worth arguing. The page's whole job is
// to be opened before it has ever been saved; a 404 would make every client
// treat "you have not filled this in yet" as a failure, and the first thing
// each of them would do about it is synthesise exactly the empty profile
// below. Better to synthesise it once, here, where the defaults can be stated.
//
// The nickname is projected from accounts.name, which is the single name an
// account has — see contracts.AccountProfileData.
func (service *AuthService) AccountProfile(ctx context.Context, accountID string) (contracts.AccountProfileData, error) {
	account, err := service.store.GetAccountByID(ctx, accountID)
	if err != nil {
		return contracts.AccountProfileData{}, err
	}
	if account.Kind != contracts.AccountKindEndUser {
		return contracts.AccountProfileData{}, ErrProfileNotForStaff
	}
	profile, err := service.store.GetAccountProfile(ctx, accountID)
	if errors.Is(err, repositories.ErrNotFound) {
		return emptyAccountProfile(account.Name), nil
	}
	if err != nil {
		return contracts.AccountProfileData{}, err
	}
	return accountProfileData(profile, account.Name), nil
}

// SaveAccountProfile replaces the profile and the display name together.
//
// Two writes rather than one, and they are not in a transaction. The reason it
// is acceptable here and would not be elsewhere: both halves are display data
// with no invariant between them, so the worst outcome of a failure between
// them is a name that saved and a profile that did not — which the page shows
// on its next read, and which the person fixes by pressing save again. A
// transaction spanning the two would buy atomicity nothing depends on.
//
// The display name goes FIRST for that reason: it is the half that also
// appears in the header menu, so if only one of the two can land, the one
// somebody will notice is the one that lands.
func (service *AuthService) SaveAccountProfile(ctx context.Context, data contracts.AccountProfileUpdateData) (contracts.AccountProfileData, error) {
	account, err := service.store.GetAccountByID(ctx, data.AccountID)
	if err != nil {
		return contracts.AccountProfileData{}, err
	}
	if account.Kind != contracts.AccountKindEndUser {
		return contracts.AccountProfileData{}, ErrProfileNotForStaff
	}
	normalizedData, err := normalizeAccountProfileUpdate(data)
	if err != nil {
		return contracts.AccountProfileData{}, err
	}

	if normalizedData.DisplayName != account.Name {
		if _, err := service.store.SetAccountDisplayName(ctx, data.AccountID, normalizedData.DisplayName); err != nil {
			return contracts.AccountProfileData{}, err
		}
	}
	savedProfile, err := service.store.UpsertAccountProfile(ctx, repositories.AccountProfile{
		AccountID:            data.AccountID,
		FullName:             normalizedData.FullName,
		Gender:               normalizedData.Gender,
		PreferredWorldFamily: normalizedData.PreferredWorldFamily,
		PreferredWorldStyle:  normalizedData.CreationDefaults.PreferredWorldStyle,
		PrimaryRole:          normalizedData.CreationDefaults.Role,
		Goal:                 normalizedData.CreationDefaults.Goal,
		Challenge:            normalizedData.CreationDefaults.Challenge,
		Mood:                 normalizedData.CreationDefaults.Mood,
		Interests:            normalizedData.CreationDefaults.Interests,
		Traits:               normalizedData.CreationDefaults.Traits,
		FavoriteColors:       normalizedData.CreationDefaults.FavoriteColors,
		AutofillCreateForm:   normalizedData.AutofillCreateForm,
	})
	if err != nil {
		return contracts.AccountProfileData{}, err
	}
	service.auditProfileUpdate(ctx, data.AccountID, account.Email, data.SourceAddress)
	return accountProfileData(savedProfile, normalizedData.DisplayName), nil
}

// normalizeAccountProfileUpdate trims, lowercases the vocabulary fields and
// enforces every bound, returning ErrProfileInvalid for anything the gateway's
// own check should already have refused.
func normalizeAccountProfileUpdate(data contracts.AccountProfileUpdateData) (contracts.AccountProfileUpdateData, error) {
	data.FullName = strings.TrimSpace(data.FullName)
	data.DisplayName = strings.TrimSpace(data.DisplayName)
	data.CreationDefaults = data.CreationDefaults.Normalize()

	if len([]rune(data.DisplayName)) > contracts.MaximumAccountDisplayNameLength {
		return data, ErrProfileInvalid
	}
	if len([]rune(data.FullName)) > contracts.MaximumFullNameLength {
		return data, ErrProfileInvalid
	}
	if !data.Gender.Valid() {
		return data, ErrProfileInvalid
	}
	// An unchosen family is valid; a named one must be real. The style is
	// checked against whichever family is set, so an empty family with a
	// non-empty style is refused - "nebula" is not a style of no family, and
	// storing it would produce a 400 at generate time on a different screen.
	if data.PreferredWorldFamily != "" && !data.PreferredWorldFamily.Valid() {
		return data, ErrProfileInvalid
	}
	if data.PreferredWorldFamily == "" && data.CreationDefaults.PreferredWorldStyle != "" {
		return data, ErrProfileInvalid
	}
	if details := data.CreationDefaults.ValidateAsCreationDefaults(data.PreferredWorldFamily); len(details) > 0 {
		return data, ErrProfileInvalid
	}
	return data, nil
}

// emptyAccountProfile is what an account that has never opened its page has.
// AutofillCreateForm is TRUE here and TRUE in the migration's default, and the
// two agreeing is not an accident: a person who fills their profile in should
// see it used without having to find a second switch, and the switch exists to
// turn that OFF.
func emptyAccountProfile(displayName string) contracts.AccountProfileData {
	return contracts.AccountProfileData{
		Gender:             contracts.GenderUnspecified,
		AutofillCreateForm: true,
		CreationDefaults: contracts.WorldInput{
			Nickname:       displayName,
			Interests:      []string{},
			Traits:         []string{},
			FavoriteColors: []string{},
		},
	}
}

func accountProfileData(profile repositories.AccountProfile, displayName string) contracts.AccountProfileData {
	return contracts.AccountProfileData{
		FullName:             profile.FullName,
		Gender:               profile.Gender,
		PreferredWorldFamily: profile.PreferredWorldFamily,
		AutofillCreateForm:   profile.AutofillCreateForm,
		UpdatedAt:            profile.UpdatedAt,
		CreationDefaults: contracts.WorldInput{
			// Projected, never stored twice. account_profiles has no nickname
			// column precisely so this is the only place the two can meet.
			Nickname:            displayName,
			Role:                profile.PrimaryRole,
			Interests:           profile.Interests,
			Traits:              profile.Traits,
			Goal:                profile.Goal,
			Challenge:           profile.Challenge,
			Mood:                profile.Mood,
			FavoriteColors:      profile.FavoriteColors,
			PreferredWorldStyle: profile.PreferredWorldStyle,
		},
	}
}

// auditProfileUpdate writes the profile-update row, and swallows a failure the
// same way audit does: an audit write that fails must not fail the request
// that was already applied.
func (service *AuthService) auditProfileUpdate(ctx context.Context, accountID, email, sourceAddress string) {
	actorAccountID := accountID
	if err := service.store.RecordAuditEvent(ctx, repositories.AuditEvent{
		ActorAccountID: &actorAccountID,
		Action:         auditActionProfileUpdate,
		Target:         email,
		Result:         auditResultSuccess,
		SourceAddress:  sourceAddress,
	}); err != nil {
		log.Error().Err(err).Str("action", auditActionProfileUpdate).Msg("record audit event")
	}
}
