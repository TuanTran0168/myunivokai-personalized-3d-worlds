package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// AdminAccountsHandler relays account:read/account:manage routes straight to
// auth-service — the gateway performs no summation or transformation of its
// own, same as every other admin-record route in this package.
type AdminAccountsHandler struct {
	transport *RPCTransport
}

func NewAdminAccountsHandler(transport *RPCTransport) *AdminAccountsHandler {
	return &AdminAccountsHandler{transport: transport}
}

func (handler *AdminAccountsHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AccountListQueryData{
		PageQueryData: pageQueryFromRequest(request),
		Search:        searchFromQuery(request),
		Kind:          accountKindFromQuery(request),
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountListQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// accountKindFromQuery validates the filter here rather than forwarding
// whatever arrived. An unrecognised value becomes NO filter, not an error and
// not a pass-through: the value ends up in a SQL equality predicate, and
// "unknown kind" must never be the shape that reaches it.
//
// Answering with the unfiltered list rather than a 400 is the deliberate half.
// This is a staff filter control, and the failure it guards against is a
// mistyped query parameter silently returning an EMPTY list that reads as
// "there are no end users" - the least useful lie this screen could tell.
func accountKindFromQuery(request *http.Request) contracts.AccountKind {
	requestedKind := contracts.AccountKind(strings.TrimSpace(request.URL.Query().Get("kind")))
	switch requestedKind {
	case contracts.AccountKindStaff, contracts.AccountKindEndUser:
		return requestedKind
	default:
		return ""
	}
}

func (handler *AdminAccountsHandler) Get(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountGetQuerySubject, contracts.AccountGetQueryData{AccountID: accountID})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Invite is the one account:manage route with no email infrastructure
// behind it yet: the raw invite token is returned to the caller (a staff
// member with account:manage) to relay out of band. See
// contracts.InviteCreateResponseData.
func (handler *AdminAccountsHandler) Invite(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Email   string   `json:"email"`
		RoleIDs []string `json:"roleIds"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthInviteCreateQuerySubject, contracts.InviteCreateData{
		Email: body.Email, RoleIDs: body.RoleIDs, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Create is the direct alternative to Invite: the actor sets the account's
// password immediately, so it is active from creation with no token to
// relay — see contracts.AccountCreateData's comment on why.
func (handler *AdminAccountsHandler) Create(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Email    string   `json:"email"`
		Name     string   `json:"name"`
		Password string   `json:"password"`
		RoleIDs  []string `json:"roleIds"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountCreateQuerySubject, contracts.AccountCreateData{
		Email: body.Email, Name: body.Name, Password: body.Password, RoleIDs: body.RoleIDs, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Update changes an account's email and/or name — see
// contracts.AccountUpdateData for why nothing else is editable here.
func (handler *AdminAccountsHandler) Update(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	accountID := chi.URLParam(request, "accountID")
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountUpdateQuerySubject, contracts.AccountUpdateData{
		AccountID: accountID, Email: body.Email, Name: body.Name, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminAccountsHandler) Disable(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	claims, _ := middleware.AdminClaims(request.Context())
	data := contracts.AccountDisableData{AccountID: accountID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context())}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountDisableQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminAccountsHandler) Enable(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	claims, _ := middleware.AdminClaims(request.Context())
	data := contracts.AccountEnableData{AccountID: accountID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context())}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountEnableQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func pageQueryFromRequest(request *http.Request) contracts.PageQueryData {
	pageSize, _ := strconv.Atoi(request.URL.Query().Get("pageSize"))
	return contracts.PageQueryData{Cursor: request.URL.Query().Get("cursor"), PageSize: pageSize}
}

// searchFromQuery reads the free-text "q" parameter every searchable admin
// list route shares (accounts, audit, worlds, jobs) — one query parameter
// name across all of them, same as pageQueryFromRequest above.
func searchFromQuery(request *http.Request) string {
	return strings.TrimSpace(request.URL.Query().Get("q"))
}

func decodeJSONBody(responseWriter http.ResponseWriter, request *http.Request, target any) bool {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must be valid JSON.")
		return false
	}
	return true
}
