package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const settingsTestAccountID = "55555555-5555-5555-5555-555555555555"

func settingsTestRouter(t *testing.T, permissions []string, routeResponses map[string]contracts.Envelope[contracts.RPCResponseData]) (http.Handler, *fakeBroker) {
	t.Helper()
	responses := map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, permissions, false),
	}
	for subject, response := range routeResponses {
		responses[subject] = response
	}
	brokerClient := &fakeBroker{responsesBySubject: responses}
	return NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil), brokerClient
}

func settingsRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, settingsTestAccountID)})
	return request
}

func TestSettingsListRelaysAuthServicesAnswer(t *testing.T) {
	listed, err := contracts.SuccessRPCEnvelope("request-settings", http.StatusOK, contracts.SettingListResponseData{
		Settings: []contracts.SettingSummary{{
			Key: string(contracts.SettingKeyQuotaAIDailyLimitAnonymous), Type: contracts.SettingTypeInteger,
			Value: "5", DefaultValue: "5", IsDeclared: true,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	router, _ := settingsTestRouter(t, []string{string(contracts.PermissionSettingsRead)},
		map[string]contracts.Envelope[contracts.RPCResponseData]{contracts.AuthSettingListQuerySubject: listed})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, settingsRequest(t, http.MethodGet, "/api/admin/settings", ""))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "quota.ai.daily_limit.anonymous") {
		t.Fatalf("expected the relayed settings list, got %s", response.Body.String())
	}
}

// The actor comes from the verified access token, never from the request.
//
// It is the same rule the profile routes follow and it matters more here: the
// row records who changed a policy number, and a field a caller could set
// would make that record a suggestion.
//
// Two things make it unreachable, and the test asserts both. The shared
// decodeJSONBody calls DisallowUnknownFields, so a body carrying
// `actorAccountId` at all is refused before anything reads it — a stronger
// guarantee than ignoring the field, because it cannot be smuggled through a
// later handler that reuses the same body struct. And the accepted body's
// payload carries the token's subject.
func TestSettingsUpdateTakesTheActorFromTheTokenAndNotTheBody(t *testing.T) {
	updated, err := contracts.SuccessRPCEnvelope("request-setting-update", http.StatusOK, contracts.SettingSummary{
		Key: string(contracts.SettingKeyAuthLockoutDuration), Value: "30m", IsDeclared: true, IsOverridden: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	router, brokerClient := settingsTestRouter(t, []string{string(contracts.PermissionSettingsManage)},
		map[string]contracts.Envelope[contracts.RPCResponseData]{contracts.AuthSettingUpdateQuerySubject: updated})

	// A body that tries to name its own actor is refused outright.
	spoofed := httptest.NewRecorder()
	router.ServeHTTP(spoofed, settingsRequest(t, http.MethodPatch,
		"/api/admin/settings/auth.lockout.duration",
		`{"value":"30m","actorAccountId":"99999999-9999-9999-9999-999999999999"}`))
	if spoofed.Code != http.StatusBadRequest {
		t.Fatalf("a body naming its own actor was answered %d rather than refused, body=%s", spoofed.Code, spoofed.Body.String())
	}
	if _, published := brokerClient.requestedPayloadsBySubject[contracts.AuthSettingUpdateQuerySubject]; published {
		t.Fatal("the spoofed body was published to auth-service")
	}

	response := httptest.NewRecorder()
	router.ServeHTTP(response, settingsRequest(t, http.MethodPatch,
		"/api/admin/settings/auth.lockout.duration", `{"value":"30m"}`))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	payload, published := brokerClient.requestedPayloadsBySubject[contracts.AuthSettingUpdateQuerySubject]
	if !published {
		t.Fatal("nothing was published to auth-service")
	}
	// RPCTransport wraps every request in an Envelope before publishing, so the
	// captured payload is the envelope and the update is its Data.
	envelope, ok := payload.(contracts.Envelope[any])
	if !ok {
		t.Fatalf("published payload is a %T, want contracts.Envelope[any]", payload)
	}
	update, ok := envelope.Data.(contracts.SettingUpdateData)
	if !ok {
		t.Fatalf("envelope data is a %T, want contracts.SettingUpdateData", envelope.Data)
	}
	if update.ActorAccountID != settingsTestAccountID {
		t.Fatalf("actor = %q, expected the token's subject %q", update.ActorAccountID, settingsTestAccountID)
	}
	// The key comes from the path and only from the path, so a caller cannot
	// aim a settings:manage write at a different setting than the route they
	// sent.
	if update.Key != string(contracts.SettingKeyAuthLockoutDuration) {
		t.Fatalf("key = %q, expected the path's %q", update.Key, contracts.SettingKeyAuthLockoutDuration)
	}
	if update.Value != "30m" {
		t.Fatalf("value = %q, expected 30m", update.Value)
	}
}

// The gateway validates against the registry BEFORE publishing, and answers
// with the bound that was broken.
//
// Both halves matter. Refusing at the edge means an unapplicable write never
// reaches auth-service; naming the bound means an operator fixes their own
// mistake instead of opening a ticket, and the message is safe to return
// because our own registry generated it rather than anything the caller sent.
func TestSettingsUpdateRefusesAnOutOfRangeValueWithoutPublishing(t *testing.T) {
	router, brokerClient := settingsTestRouter(t, []string{string(contracts.PermissionSettingsManage)}, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, settingsRequest(t, http.MethodPatch,
		"/api/admin/settings/auth.lockout.duration", `{"value":"48h"}`))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "between") {
		t.Fatalf("the refusal does not name the bound that was broken: %s", response.Body.String())
	}
	if _, published := brokerClient.requestedPayloadsBySubject[contracts.AuthSettingUpdateQuerySubject]; published {
		t.Fatal("an out-of-range write was published to auth-service anyway")
	}
}

// A key the registry does not declare is a 404, and nothing is published.
//
// 404 rather than 400 because the key names nothing that exists — an operator
// reaching this has a stale screen or a hand-written request, and a 400 would
// send them looking at the value.
func TestSettingsUpdateRefusesAnUndeclaredKeyWithoutPublishing(t *testing.T) {
	undeclaredKeys := []string{
		"auth.lockout.forever",
		"AUTH_LOCKOUT_DURATION",
		"quota.ai.daily_limit.invented",
	}
	for _, key := range undeclaredKeys {
		t.Run(key, func(t *testing.T) {
			router, brokerClient := settingsTestRouter(t, []string{string(contracts.PermissionSettingsManage)}, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, settingsRequest(t, http.MethodPatch, "/api/admin/settings/"+key, `{"value":"1h"}`))

			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404, body=%s", response.Code, response.Body.String())
			}
			if _, published := brokerClient.requestedPayloadsBySubject[contracts.AuthSettingUpdateQuerySubject]; published {
				t.Fatal("a write to an undeclared key was published to auth-service anyway")
			}
		})
	}
}

// Reading the settings and changing one are two permissions, and holding the
// first does not grant the second. This is the story's own acceptance line:
// "a staff member holding only `settings:read` can see the settings but not
// change one."
func TestSettingsReadDoesNotGrantSettingsManage(t *testing.T) {
	listed, err := contracts.SuccessRPCEnvelope("request-settings", http.StatusOK, contracts.SettingListResponseData{})
	if err != nil {
		t.Fatal(err)
	}
	router, brokerClient := settingsTestRouter(t, []string{string(contracts.PermissionSettingsRead)},
		map[string]contracts.Envelope[contracts.RPCResponseData]{contracts.AuthSettingListQuerySubject: listed})

	readResponse := httptest.NewRecorder()
	router.ServeHTTP(readResponse, settingsRequest(t, http.MethodGet, "/api/admin/settings", ""))
	if readResponse.Code != http.StatusOK {
		t.Fatalf("a settings:read holder could not read the settings: %d %s", readResponse.Code, readResponse.Body.String())
	}

	writeResponse := httptest.NewRecorder()
	router.ServeHTTP(writeResponse, settingsRequest(t, http.MethodPatch,
		"/api/admin/settings/auth.lockout.duration", `{"value":"30m"}`))
	if writeResponse.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a settings:read holder writing a setting, body=%s", writeResponse.Code, writeResponse.Body.String())
	}
	if _, published := brokerClient.requestedPayloadsBySubject[contracts.AuthSettingUpdateQuerySubject]; published {
		t.Fatal("the write reached auth-service despite the 403")
	}
}

// And the other direction: settings:manage does not let a caller read the
// list. Written because the pair is easy to collapse into one code by
// somebody tidying the router, and the collapse is invisible from either test
// above on its own.
func TestSettingsManageDoesNotGrantSettingsRead(t *testing.T) {
	router, _ := settingsTestRouter(t, []string{string(contracts.PermissionSettingsManage)}, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, settingsRequest(t, http.MethodGet, "/api/admin/settings", ""))
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a settings:manage holder reading the list, body=%s", response.Code, response.Body.String())
	}
}
