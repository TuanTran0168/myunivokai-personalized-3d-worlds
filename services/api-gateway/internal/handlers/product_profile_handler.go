package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// productProfileBody is the account page's own shape, and the SAME shape
// travels both ways: what GET returns is what PATCH accepts. That is what lets
// the page load, edit and save without translating between two models, and it
// is why there is no separate response type here.
//
// CreationDefaults is contracts.WorldInput, the very type the generate call
// takes, so the profile cannot express something the create form could not
// hold — and so this handler can hand it straight to
// ValidateAsCreationDefaults rather than re-listing nine fields.
//
// The whole body is sent on every save, and the handler treats it that way. A
// merge would make a field somebody cleared indistinguishable from one the
// request never mentioned, which on a form with six optional text fields is
// the difference between "delete my goal" and "leave my goal alone".
type productProfileBody struct {
	DisplayName          string                  `json:"displayName"`
	FullName             string                  `json:"fullName"`
	Gender               contracts.AccountGender `json:"gender"`
	PreferredWorldFamily contracts.WorldFamily   `json:"preferredWorldFamily"`
	CreationDefaults     contracts.WorldInput    `json:"creationDefaults"`
	AutofillCreateForm   bool                    `json:"autofillCreateForm"`
}

// Profile serves the account's own page.
//
// The account id comes from the verified token's subject and from nowhere
// else. There is no `{accountID}` in the route and no account id in the body,
// so "my profile" is not a claim this endpoint has to check — it is the only
// thing it can express.
func (handler *ProductAuthHandler) Profile(responseWriter http.ResponseWriter, request *http.Request) {
	claims, present := middleware.ProductClaims(request.Context())
	if !present {
		httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid session is required.")
		return
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthWebProfileGetQuerySubject, contracts.AccountProfileGetData{
		AccountID: claims.Subject,
	})
	if !ok {
		return
	}
	writeProfileResponse(responseWriter, request, response.Data.Payload)
}

// UpdateProfile replaces the account's page.
//
// PATCH with a whole body, matching the admin surface's own account update
// rather than introducing PUT for one route — see admin_router.go, where
// PATCH is already the verb for "change this resource" and already carries
// every field it changes.
func (handler *ProductAuthHandler) UpdateProfile(responseWriter http.ResponseWriter, request *http.Request) {
	claims, present := middleware.ProductClaims(request.Context())
	if !present {
		httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid session is required.")
		return
	}
	var body productProfileBody
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	body.CreationDefaults = body.CreationDefaults.Normalize()
	if !handler.profileIsValid(responseWriter, request, body) {
		return
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthWebProfileUpdateQuerySubject, contracts.AccountProfileUpdateData{
		AccountID:            claims.Subject,
		DisplayName:          body.DisplayName,
		FullName:             body.FullName,
		Gender:               body.Gender,
		PreferredWorldFamily: body.PreferredWorldFamily,
		CreationDefaults:     body.CreationDefaults,
		AutofillCreateForm:   body.AutofillCreateForm,
		SourceAddress:        httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	writeProfileResponse(responseWriter, request, response.Data.Payload)
}

// profileIsValid answers field by field, the way world_handler.go answers the
// generate call, and writes the rejection itself.
//
// The per-field detail is the reason this check lives here rather than only in
// auth-service: this is the layer with a caller to report to, and a form with
// eleven inputs that is told only "invalid" is a form somebody has to guess
// at. auth-service still refuses the same input — ErrProfileInvalid — because
// the edge is where the message lives, not where the invariant does.
func (handler *ProductAuthHandler) profileIsValid(responseWriter http.ResponseWriter, request *http.Request, body productProfileBody) bool {
	var details []contracts.ValidationDetail
	if runeCount(body.DisplayName) > contracts.MaximumAccountDisplayNameLength {
		details = append(details, contracts.ValidationDetail{
			Field:   "displayName",
			Message: fmt.Sprintf("A display name can be at most %d characters.", contracts.MaximumAccountDisplayNameLength),
		})
	}
	if runeCount(body.FullName) > contracts.MaximumFullNameLength {
		details = append(details, contracts.ValidationDetail{
			Field:   "fullName",
			Message: fmt.Sprintf("A full name can be at most %d characters.", contracts.MaximumFullNameLength),
		})
	}
	if !body.Gender.Valid() {
		details = append(details, contracts.ValidationDetail{Field: "gender", Message: "That is not one of the available options."})
	}
	// An empty family means "not chosen" and is valid. A named one must be
	// real, and a style with no family behind it is refused: a world style
	// belongs to a family's own vocabulary, so storing one with no family
	// would produce a 400 later, at generate time, on a different screen.
	if body.PreferredWorldFamily != "" && !body.PreferredWorldFamily.Valid() {
		details = append(details, contracts.ValidationDetail{Field: "preferredWorldFamily", Message: "That is not one of the available world families."})
	}
	if body.PreferredWorldFamily == "" && body.CreationDefaults.PreferredWorldStyle != "" {
		details = append(details, contracts.ValidationDetail{Field: "preferredWorldStyle", Message: "Choose a world family before a world style."})
	}
	// Validated as a DRAFT, never as a submission: a half-filled profile is a
	// legitimate thing to save, and demanding a complete world before somebody
	// can record their own name would make this page unusable the first time it
	// is opened. See contracts.WorldInput.ValidateAsCreationDefaults.
	details = append(details, body.CreationDefaults.ValidateAsCreationDefaults(body.PreferredWorldFamily)...)

	if len(details) > 0 {
		httpx.WriteErrorWithDetails(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Please check the highlighted fields.", details)
		return false
	}
	return true
}

// writeProfileResponse re-marshals auth-service's answer rather than
// forwarding the raw payload, for the same reason toProductAccountBody exists:
// the response model is the promise, and a service that later added a field to
// AccountProfileData must not be able to publish it to a browser by accident.
func writeProfileResponse(responseWriter http.ResponseWriter, request *http.Request, payload json.RawMessage) {
	var profile contracts.AccountProfileData
	if err := json.Unmarshal(payload, &profile); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
		return
	}
	httpx.WriteJSON(responseWriter, http.StatusOK, productProfileBody{
		// The display name IS CreationDefaults.Nickname - accounts.name,
		// projected by auth-service. It appears twice in this response on
		// purpose: once where the page edits it, and once inside the block the
		// create form copies wholesale.
		DisplayName:          profile.CreationDefaults.Nickname,
		FullName:             profile.FullName,
		Gender:               profile.Gender,
		PreferredWorldFamily: profile.PreferredWorldFamily,
		CreationDefaults:     profile.CreationDefaults,
		AutofillCreateForm:   profile.AutofillCreateForm,
	})
}

func runeCount(value string) int {
	return len([]rune(value))
}
