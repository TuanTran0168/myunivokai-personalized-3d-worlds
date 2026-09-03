package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const testProfileAccountID = "account-1"

func savedProfileEnvelope(t *testing.T) contracts.Envelope[contracts.RPCResponseData] {
	t.Helper()
	envelope, err := contracts.SuccessRPCEnvelope("request-profile", http.StatusOK, contracts.AccountProfileData{
		FullName:             "Nguyen Van Neo",
		Gender:               contracts.GenderPreferNotToSay,
		PreferredWorldFamily: contracts.WorldFamilyOcean,
		AutofillCreateForm:   true,
		CreationDefaults: contracts.WorldInput{
			Nickname: "Neo", Role: "Explorer", Goal: "Chart the shelf",
			Interests: []string{"Art"}, Traits: []string{"calm"},
			Mood: "dreamy", FavoriteColors: []string{"#F97316"}, PreferredWorldStyle: "coral-garden",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func profileRouter(t *testing.T) (http.Handler, *fakeBroker) {
	t.Helper()
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:     tokenVersionResponseEnvelope(t),
		contracts.AuthWebProfileGetQuerySubject:    savedProfileEnvelope(t),
		contracts.AuthWebProfileUpdateQuerySubject: savedProfileEnvelope(t),
	}}
	return NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil), brokerClient
}

func signedInRequest(t *testing.T, method, path, body string) *http.Request {
	t.Helper()
	var request *http.Request
	if body == "" {
		request = httptest.NewRequest(method, path, nil)
	} else {
		request = httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, testProfileAccountID, contracts.AccountAudienceWeb))
	return request
}

// The whole of "my profile means mine": there is no account id in the route
// and none in the body, so the only id that can reach auth-service is the one
// the verified token carried.
func TestTheProfileAccountIDComesFromTheTokenAndNowhereElse(t *testing.T) {
	router, brokerClient := profileRouter(t)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, signedInRequest(t, http.MethodPatch, "/api/me/profile",
		`{"displayName":"Neo","creationDefaults":{"interests":[],"traits":[],"favoriteColors":[]}}`))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	sentPayload, found := brokerClient.requestedPayloadsBySubject[contracts.AuthWebProfileUpdateQuerySubject]
	if !found {
		t.Fatalf("the update subject was never published; got %v", brokerClient.requestedSubjects)
	}
	// RPCTransport wraps every request in an Envelope before publishing, so
	// the captured payload is the envelope and the update is its Data.
	envelope, ok := sentPayload.(contracts.Envelope[any])
	if !ok {
		t.Fatalf("payload type = %T, want contracts.Envelope[any]", sentPayload)
	}
	update, ok := envelope.Data.(contracts.AccountProfileUpdateData)
	if !ok {
		t.Fatalf("envelope data type = %T, want contracts.AccountProfileUpdateData", envelope.Data)
	}
	if update.AccountID != testProfileAccountID {
		t.Fatalf("accountId = %q, want the token's subject %q", update.AccountID, testProfileAccountID)
	}
}

// The second half of the same guarantee, and the stronger one: a body naming
// somebody else's account is not ignored, it is REFUSED. productProfileBody
// has no accountId field and decodeJSONBody disallows unknown ones, so the
// request shape cannot express the attempt at all.
//
// Worth its own test rather than trusting the struct definition, because
// adding an innocuous-looking field to that struct would silently turn a 400
// into an ignored value - and "ignored" is one careless assignment away from
// "honoured".
func TestTheProfileSaveRefusesABodyThatNamesAnAccount(t *testing.T) {
	router, brokerClient := profileRouter(t)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, signedInRequest(t, http.MethodPatch, "/api/me/profile",
		`{"displayName":"Neo","accountId":"somebody-elses-account","creationDefaults":{}}`))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", response.Code, response.Body.String())
	}
	for _, subject := range brokerClient.requestedSubjects {
		if subject == contracts.AuthWebProfileUpdateQuerySubject {
			t.Error("a body naming another account reached auth-service")
		}
	}
}

func TestTheProfileGetReturnsTheSavedProfile(t *testing.T) {
	router, _ := profileRouter(t)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, signedInRequest(t, http.MethodGet, "/api/me/profile", ""))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var profile productProfileBody
	if err := json.Unmarshal(response.Body.Bytes(), &profile); err != nil {
		t.Fatalf("decode profile body: %v", err)
	}
	// The display name is the projection of accounts.name, and both places it
	// appears must agree - the page edits one and the create form copies the
	// other.
	if profile.DisplayName != "Neo" || profile.CreationDefaults.Nickname != "Neo" {
		t.Fatalf("displayName = %q, creationDefaults.nickname = %q, want both to be Neo", profile.DisplayName, profile.CreationDefaults.Nickname)
	}
	if profile.FullName != "Nguyen Van Neo" || profile.Gender != contracts.GenderPreferNotToSay {
		t.Fatalf("profile = %+v, want the saved one", profile)
	}
}

// Field by field, the way world_handler.go answers the generate call. A form
// with eleven inputs told only "invalid" is a form somebody has to guess at.
func TestTheProfileSaveAnswersWithTheFieldThatIsWrong(t *testing.T) {
	testCases := []struct {
		name          string
		body          string
		expectedField string
	}{
		{
			name:          "a display name past the ceiling",
			body:          `{"displayName":"` + strings.Repeat("n", contracts.MaximumAccountDisplayNameLength+1) + `","creationDefaults":{}}`,
			expectedField: "displayName",
		},
		{
			name:          "a full name past the ceiling",
			body:          `{"fullName":"` + strings.Repeat("n", contracts.MaximumFullNameLength+1) + `","creationDefaults":{}}`,
			expectedField: "fullName",
		},
		{
			name:          "a gender outside the closed set",
			body:          `{"gender":"something-else","creationDefaults":{}}`,
			expectedField: "gender",
		},
		{
			name:          "a world family that does not exist",
			body:          `{"preferredWorldFamily":"city","creationDefaults":{}}`,
			expectedField: "preferredWorldFamily",
		},
		{
			// Stored, it would produce a 400 later at generate time, on a
			// screen that could not explain it.
			name:          "a style with no family chosen",
			body:          `{"creationDefaults":{"preferredWorldStyle":"nebula"}}`,
			expectedField: "preferredWorldStyle",
		},
		{
			name:          "a colour that is not a hex value",
			body:          `{"creationDefaults":{"favoriteColors":["crimson"]}}`,
			expectedField: "favoriteColors",
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			router, brokerClient := profileRouter(t)

			response := httptest.NewRecorder()
			router.ServeHTTP(response, signedInRequest(t, http.MethodPatch, "/api/me/profile", testCase.body))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body = %s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), testCase.expectedField) {
				t.Errorf("the rejection does not name %q; body = %s", testCase.expectedField, response.Body.String())
			}
			// Rejected at the edge, so a cold auth-service is not woken to say
			// no - the same rule the malformed-email test already asserts.
			for _, subject := range brokerClient.requestedSubjects {
				if subject == contracts.AuthWebProfileUpdateQuerySubject {
					t.Errorf("an invalid profile reached auth-service")
				}
			}
		})
	}
}

// A DRAFT, not a submission. contracts.WorldInput.Validate would refuse every
// one of these, and refusing them here would make the page unusable the first
// time it is opened.
func TestTheProfileSaveAcceptsAHalfFilledForm(t *testing.T) {
	router, brokerClient := profileRouter(t)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, signedInRequest(t, http.MethodPatch, "/api/me/profile",
		`{"displayName":"Neo","creationDefaults":{"interests":["Art"],"goal":"Ship it","traits":[],"favoriteColors":[]}}`))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	if _, found := brokerClient.requestedPayloadsBySubject[contracts.AuthWebProfileUpdateQuerySubject]; !found {
		t.Fatal("a valid partial profile must reach auth-service")
	}
}

func TestTheProfileRoutesRefuseAnAdminAudienceToken(t *testing.T) {
	router, _ := profileRouter(t)

	for _, testCase := range []struct{ method, body string }{
		{http.MethodGet, ""},
		{http.MethodPatch, `{"creationDefaults":{}}`},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(testCase.method, "/api/me/profile", strings.NewReader(testCase.body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, testProfileAccountID, contracts.AccountAudienceAdmin))
		router.ServeHTTP(response, request)

		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s /api/me/profile with an admin token: status = %d, want 401", testCase.method, response.Code)
		}
	}
}

// PATCH is the verb, so the shared product CORS policy has to permit it or the
// browser never sends the request at all - and a preflight failure is silent
// in the network tab of the person debugging it.
func TestTheProductCORSPolicyAllowsTheProfileSaveMethod(t *testing.T) {
	allowedMethods := productCORSOptions(testGatewayConfig()).AllowedMethods

	found := false
	for _, method := range allowedMethods {
		if method == http.MethodPatch {
			found = true
		}
	}
	if !found {
		t.Fatalf("PATCH is not in the product CORS policy (%v), so the account page cannot save from a browser", allowedMethods)
	}
}
