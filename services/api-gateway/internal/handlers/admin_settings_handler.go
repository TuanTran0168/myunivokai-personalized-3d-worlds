package handlers

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// settingKeyURLParameter carries a dotted key such as `auth.lockout.duration`.
// A dot is an ordinary character inside one path segment, so the key needs no
// encoding and the route needs no wildcard.
const settingKeyURLParameter = "settingKey"

// AdminSettingsHandler relays the two settings routes to auth-service, which
// owns the table. The gateway performs no transformation of its own, same as
// every other admin-record route in this package — with one addition it does
// not make elsewhere: it validates the WRITE against the declared registry
// before publishing.
//
// That validation is not a duplicate of auth-service's. It is the half that
// can answer the operator with the bound they broke, because contracts holds
// the registry and both services read the same copy. auth-service's own check
// stays as the invariant behind it, for anything that publishes the subject
// directly, and answers without detail exactly as the profile path does.
type AdminSettingsHandler struct {
	transport *RPCTransport
}

func NewAdminSettingsHandler(transport *RPCTransport) *AdminSettingsHandler {
	return &AdminSettingsHandler{transport: transport}
}

func (handler *AdminSettingsHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthSettingListQuerySubject, struct{}{})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Update writes one setting. The key comes from the path and the value from
// the body; the ACTOR comes from the verified access token and is never read
// from the request, so the row's record of who changed a policy number cannot
// be set by whoever sent the request.
func (handler *AdminSettingsHandler) Update(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Value string `json:"value"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	settingKey := contracts.SettingKey(strings.TrimSpace(chi.URLParam(request, settingKeyURLParameter)))
	definition, declared := contracts.SettingDefinitionFor(settingKey)
	if !declared {
		// A 404 rather than a 400: the key names nothing that exists. An
		// operator reaching this has a stale screen or a hand-written request,
		// not a bad number — and answering 400 would send them looking at the
		// value.
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "SETTING_NOT_DECLARED", "That setting does not exist.")
		return
	}
	if err := definition.ValidateValue(body.Value); err != nil {
		// The message names the bound that was broken, because it is generated
		// by our own registry rather than by anything the caller sent. This is
		// a staff route: an operator told "must be between 1m and 24h" fixes
		// their own mistake, and one told "invalid value" opens a ticket.
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	claims, _ := middleware.AdminClaims(request.Context())
	data := contracts.SettingUpdateData{
		Key:            string(settingKey),
		Value:          strings.TrimSpace(body.Value),
		ActorAccountID: claims.Subject,
		SourceAddress:  httpx.ClientIP(request.Context()),
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthSettingUpdateQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}
