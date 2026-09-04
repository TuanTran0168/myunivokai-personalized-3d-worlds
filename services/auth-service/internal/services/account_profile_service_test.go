package services

import (
	"context"
	"errors"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

// A profile whose every field is filled, so a test asserting one field cannot
// pass because the rest of the struct was zero.
func filledProfileUpdate(accountID string) contracts.AccountProfileUpdateData {
	return contracts.AccountProfileUpdateData{
		AccountID:            accountID,
		DisplayName:          "Neo",
		FullName:             "Nguyen Van Neo",
		Gender:               contracts.GenderPreferNotToSay,
		PreferredWorldFamily: contracts.WorldFamilyOcean,
		AutofillCreateForm:   true,
		CreationDefaults: contracts.WorldInput{
			Role:                "Explorer",
			Goal:                "Chart the shelf",
			Challenge:           "Time",
			Interests:           []string{"Art", "Music"},
			Traits:              []string{"calm"},
			Mood:                "dreamy",
			FavoriteColors:      []string{"#F97316"},
			PreferredWorldStyle: "coral-garden",
		},
		SourceAddress: "203.0.113.7",
	}
}

func TestAccountProfile_IsEmptyRatherThanMissingBeforeItIsEverSaved(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	profile, err := authService.AccountProfile(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read a profile that was never saved: %v", err)
	}

	// The whole point of not returning ErrNotFound: the page's job is to be
	// opened before it has ever been saved.
	if profile.FullName != "" || profile.Gender != contracts.GenderUnspecified {
		t.Errorf("expected an empty profile, got full name %q and gender %q", profile.FullName, profile.Gender)
	}
	if !profile.AutofillCreateForm {
		t.Error("autofill must default to on, so a profile somebody fills in is used without a second action")
	}
	// Never nil, so a client cannot tell an absent list from an empty one.
	if profile.CreationDefaults.Interests == nil || profile.CreationDefaults.Traits == nil || profile.CreationDefaults.FavoriteColors == nil {
		t.Error("the three lists must be empty rather than nil")
	}
}

func TestAccountProfile_ProjectsTheAccountNameAsTheNickname(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session, err := authService.SignUpEndUser(context.Background(), contracts.WebSignupData{
		Email: "visitor@example.com", Name: "Neo", Password: testEndUserPassword,
	})
	if err != nil {
		t.Fatalf("sign up: %v", err)
	}

	profile, err := authService.AccountProfile(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read profile: %v", err)
	}

	// There is one name. account_profiles has no nickname column, and this
	// projection is why - the header menu and the create form cannot greet the
	// same person differently.
	if profile.CreationDefaults.Nickname != "Neo" {
		t.Errorf("expected the nickname to be the account name, got %q", profile.CreationDefaults.Nickname)
	}
}

func TestSaveAccountProfile_StoresEveryFieldAndReadsItBack(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	saved, err := authService.SaveAccountProfile(context.Background(), filledProfileUpdate(session.Account.AccountID))
	if err != nil {
		t.Fatalf("save profile: %v", err)
	}

	readBack, err := authService.AccountProfile(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read profile: %v", err)
	}
	for _, comparison := range []struct {
		field  string
		saved  string
		reread string
	}{
		{"fullName", saved.FullName, readBack.FullName},
		{"gender", string(saved.Gender), string(readBack.Gender)},
		{"preferredWorldFamily", string(saved.PreferredWorldFamily), string(readBack.PreferredWorldFamily)},
		{"nickname", saved.CreationDefaults.Nickname, readBack.CreationDefaults.Nickname},
		{"role", saved.CreationDefaults.Role, readBack.CreationDefaults.Role},
		{"goal", saved.CreationDefaults.Goal, readBack.CreationDefaults.Goal},
		{"challenge", saved.CreationDefaults.Challenge, readBack.CreationDefaults.Challenge},
		{"mood", saved.CreationDefaults.Mood, readBack.CreationDefaults.Mood},
		{"preferredWorldStyle", saved.CreationDefaults.PreferredWorldStyle, readBack.CreationDefaults.PreferredWorldStyle},
		{"interests", strings.Join(saved.CreationDefaults.Interests, ","), strings.Join(readBack.CreationDefaults.Interests, ",")},
		{"traits", strings.Join(saved.CreationDefaults.Traits, ","), strings.Join(readBack.CreationDefaults.Traits, ",")},
		{"favoriteColors", strings.Join(saved.CreationDefaults.FavoriteColors, ","), strings.Join(readBack.CreationDefaults.FavoriteColors, ",")},
	} {
		if comparison.saved != comparison.reread {
			t.Errorf("%s did not survive the round trip: saved %q, read back %q", comparison.field, comparison.saved, comparison.reread)
		}
	}
	if readBack.CreationDefaults.Nickname != "Neo" {
		t.Errorf("expected the display name to become the nickname, got %q", readBack.CreationDefaults.Nickname)
	}
}

// The display name is written to accounts.name, which is what the header menu
// and every future world attribution read. A save that only touched
// account_profiles would look like it worked and change nothing anybody sees.
func TestSaveAccountProfile_WritesTheDisplayNameOntoTheAccount(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	if _, err := authService.SaveAccountProfile(context.Background(), filledProfileUpdate(session.Account.AccountID)); err != nil {
		t.Fatalf("save profile: %v", err)
	}

	account, err := store.GetAccountByID(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read account: %v", err)
	}
	if account.Name != "Neo" {
		t.Errorf("expected accounts.name to be the saved display name, got %q", account.Name)
	}
}

// A DRAFT, not a submission. WorldInput.Validate would refuse all of this, and
// refusing it here would make the page unusable the first time it is opened.
func TestSaveAccountProfile_AcceptsAHalfFilledProfile(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	saved, err := authService.SaveAccountProfile(context.Background(), contracts.AccountProfileUpdateData{
		AccountID:   session.Account.AccountID,
		DisplayName: "Neo",
		CreationDefaults: contracts.WorldInput{
			// One interest, no traits, a two-word goal, no mood, no colours -
			// every one of these is below a Validate minimum.
			Interests: []string{"Art"},
			Goal:      "Ship it",
		},
	})
	if err != nil {
		t.Fatalf("a partially filled profile must be saveable: %v", err)
	}
	if len(saved.CreationDefaults.Interests) != 1 || saved.CreationDefaults.Goal != "Ship it" {
		t.Errorf("expected the partial answers to be kept, got %+v", saved.CreationDefaults)
	}
}

func TestSaveAccountProfile_RefusesWhatTheVocabulariesDoNotAdmit(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	testCases := []struct {
		name   string
		change func(*contracts.AccountProfileUpdateData)
	}{
		{"a gender outside the closed set", func(data *contracts.AccountProfileUpdateData) {
			data.Gender = contracts.AccountGender("something-else")
		}},
		{"a world family that does not exist", func(data *contracts.AccountProfileUpdateData) {
			data.PreferredWorldFamily = contracts.WorldFamily("city")
		}},
		{"a style belonging to another family", func(data *contracts.AccountProfileUpdateData) {
			data.PreferredWorldFamily = contracts.WorldFamilyNature
			data.CreationDefaults.PreferredWorldStyle = "nebula"
		}},
		// A style with no family behind it would be stored and then rejected
		// at generate time, on a screen that cannot explain it.
		{"a style with no family chosen", func(data *contracts.AccountProfileUpdateData) {
			data.PreferredWorldFamily = ""
			data.CreationDefaults.PreferredWorldStyle = "nebula"
		}},
		{"a mood outside the vocabulary", func(data *contracts.AccountProfileUpdateData) {
			data.CreationDefaults.Mood = "hungry"
		}},
		{"a display name past the ceiling", func(data *contracts.AccountProfileUpdateData) {
			data.DisplayName = strings.Repeat("n", contracts.MaximumAccountDisplayNameLength+1)
		}},
		{"a full name past the ceiling", func(data *contracts.AccountProfileUpdateData) {
			data.FullName = strings.Repeat("n", contracts.MaximumFullNameLength+1)
		}},
		{"a colour that is not a hex value", func(data *contracts.AccountProfileUpdateData) {
			data.CreationDefaults.FavoriteColors = []string{"crimson"}
		}},
		{"more interests than the form can hold", func(data *contracts.AccountProfileUpdateData) {
			data.CreationDefaults.Interests = []string{"a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"}
		}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			data := filledProfileUpdate(session.Account.AccountID)
			testCase.change(&data)
			if _, err := authService.SaveAccountProfile(context.Background(), data); !errors.Is(err, ErrProfileInvalid) {
				t.Fatalf("expected ErrProfileInvalid, got %v", err)
			}
		})
	}
}

// Counted in runes. A byte ceiling would admit 32 characters in one alphabet
// and refuse 32 in another, and this product is used in Vietnamese.
func TestSaveAccountProfile_CountsADisplayNameInCharactersNotBytes(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	data := filledProfileUpdate(session.Account.AccountID)
	// 30 characters, 90 bytes in UTF-8.
	data.DisplayName = strings.Repeat("ườ", 15)
	if len(data.DisplayName) <= contracts.MaximumAccountDisplayNameLength {
		t.Fatalf("this test needs a name whose BYTE length exceeds the ceiling; got %d bytes", len(data.DisplayName))
	}

	if _, err := authService.SaveAccountProfile(context.Background(), data); err != nil {
		t.Fatalf("a 30-character Vietnamese name must be accepted: %v", err)
	}
}

// The subject is product-audience only, so reaching here with a staff account
// means something upstream is wrong rather than that a feature is missing.
func TestAccountProfile_RefusesAStaffAccount(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	staffAccount, err := store.CreateAccount(context.Background(), repositories.CreateAccountParams{
		Email: "staff@example.com", PasswordHash: "a-hash", Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		t.Fatalf("create staff account: %v", err)
	}

	if _, err := authService.AccountProfile(context.Background(), staffAccount.ID); !errors.Is(err, ErrProfileNotForStaff) {
		t.Errorf("reading a staff profile: expected ErrProfileNotForStaff, got %v", err)
	}
	data := filledProfileUpdate(staffAccount.ID)
	if _, err := authService.SaveAccountProfile(context.Background(), data); !errors.Is(err, ErrProfileNotForStaff) {
		t.Errorf("saving a staff profile: expected ErrProfileNotForStaff, got %v", err)
	}
}

// Clearing a field is a real edit, and the whole-body replace is what makes it
// possible. A merge would leave the old value behind and there would be no way
// to remove one.
func TestSaveAccountProfile_ClearingAFieldClearsIt(t *testing.T) {
	authService, _, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")
	if _, err := authService.SaveAccountProfile(context.Background(), filledProfileUpdate(session.Account.AccountID)); err != nil {
		t.Fatalf("first save: %v", err)
	}

	if _, err := authService.SaveAccountProfile(context.Background(), contracts.AccountProfileUpdateData{
		AccountID: session.Account.AccountID, DisplayName: "Neo",
	}); err != nil {
		t.Fatalf("second save: %v", err)
	}

	readBack, err := authService.AccountProfile(context.Background(), session.Account.AccountID)
	if err != nil {
		t.Fatalf("read profile: %v", err)
	}
	if readBack.FullName != "" || readBack.CreationDefaults.Goal != "" || len(readBack.CreationDefaults.Interests) != 0 {
		t.Errorf("expected the cleared fields to be empty, got %+v", readBack)
	}
	if readBack.PreferredWorldFamily != "" {
		t.Errorf("expected the family to be cleared, got %q", readBack.PreferredWorldFamily)
	}
}

func TestSaveAccountProfile_WritesAnAuditRow(t *testing.T) {
	authService, store, _ := newTestAuthServiceWithIssuer(t)
	session := signUpTestEndUser(t, authService, "visitor@example.com")

	if _, err := authService.SaveAccountProfile(context.Background(), filledProfileUpdate(session.Account.AccountID)); err != nil {
		t.Fatalf("save profile: %v", err)
	}

	events, _, _, err := store.ListAuditEvents(context.Background(), "", 50, nil, nil, "")
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	found := false
	for _, event := range events {
		if event.Action == auditActionProfileUpdate {
			found = true
			if event.ActorAccountID == nil || *event.ActorAccountID != session.Account.AccountID {
				t.Errorf("expected the actor to be the account itself, got %v", event.ActorAccountID)
			}
		}
	}
	if !found {
		// accounts.name is what people are greeted by; "who changed this name,
		// and when" is a question that gets asked.
		t.Error("a profile save must leave an audit row")
	}
}
