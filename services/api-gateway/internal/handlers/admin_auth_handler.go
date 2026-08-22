package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// adminAuthCookiePath scopes the refresh cookie to exactly the two routes
// that ever read it - refresh and logout - so it is never sent on the wider
// admin surface those routes' siblings will grow. See
// notes/vision/auth-and-admin-plan.md#tokens.
const adminAuthCookiePath = "/api/admin/auth"

type loginRequestBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// sessionResponseBody is contracts/openapi-admin.yaml's SessionResponse: the
// access and refresh tokens travel as cookies, never in this body, so an XSS
// reading the response cannot exfiltrate them.
type sessionResponseBody struct {
	Account          contracts.AccountSummary `json:"account"`
	AccessExpiresAt  time.Time                `json:"accessExpiresAt"`
	RefreshExpiresAt time.Time                `json:"refreshExpiresAt"`
}

// AdminAuthHandler answers the three routes contracts/openapi-admin.yaml
// freezes for this phase. It shares RPCTransport.Request with every other
// gateway handler, but never Proxy: a login/refresh response must never be
// written into the Redis response cache.
type AdminAuthHandler struct {
	transport     *RPCTransport
	secureCookies bool
}

func NewAdminAuthHandler(serviceConfig config.Config, transport *RPCTransport) *AdminAuthHandler {
	return &AdminAuthHandler{transport: transport, secureCookies: serviceConfig.IsProduction()}
}

func (handler *AdminAuthHandler) Login(responseWriter http.ResponseWriter, request *http.Request) {
	var body loginRequestBody
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must be valid JSON.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must contain one JSON object.")
		return
	}
	if strings.TrimSpace(body.Email) == "" || body.Password == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email and password are required.")
		return
	}
	handler.completeSession(responseWriter, request, contracts.AuthLoginQuerySubject, contracts.LoginData{
		Email: body.Email, Password: body.Password, SourceAddress: httpx.ClientIP(request.Context()),
	})
}

// AcceptInvite is public, like Login: the caller has only the one-time
// invite token, no session yet, so it cannot sit behind RequireAdminAccessToken
// or RequireAdminPermission.
func (handler *AdminAuthHandler) AcceptInvite(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		InviteToken string `json:"inviteToken"`
		Password    string `json:"password"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	if strings.TrimSpace(body.InviteToken) == "" || body.Password == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invite token and password are required.")
		return
	}
	handler.completeSession(responseWriter, request, contracts.AuthInviteAcceptQuerySubject, contracts.InviteAcceptData{
		InviteToken: body.InviteToken, Password: body.Password, SourceAddress: httpx.ClientIP(request.Context()),
	})
}

func (handler *AdminAuthHandler) Refresh(responseWriter http.ResponseWriter, request *http.Request) {
	handler.completeSession(responseWriter, request, contracts.AuthRefreshQuerySubject, contracts.RefreshData{
		RefreshToken: middleware.AdminRefreshToken(request.Context()), SourceAddress: httpx.ClientIP(request.Context()),
	})
}

func (handler *AdminAuthHandler) Logout(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.LogoutData{
		RefreshToken: middleware.AdminRefreshToken(request.Context()), SourceAddress: httpx.ClientIP(request.Context()),
	}
	if _, ok := handler.transport.Request(responseWriter, request, contracts.AuthLogoutQuerySubject, data); !ok {
		return
	}
	handler.clearSessionCookies(responseWriter)
	responseWriter.WriteHeader(http.StatusNoContent)
}

func (handler *AdminAuthHandler) completeSession(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) {
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	var session contracts.LoginResponseData
	if err := json.Unmarshal(response.Data.Payload, &session); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
		return
	}
	handler.setSessionCookies(responseWriter, session)
	httpx.WriteJSON(responseWriter, http.StatusOK, sessionResponseBody{
		Account: session.Account, AccessExpiresAt: session.AccessExpiresAt, RefreshExpiresAt: session.RefreshExpiresAt,
	})
}

func (handler *AdminAuthHandler) setSessionCookies(responseWriter http.ResponseWriter, session contracts.LoginResponseData) {
	http.SetCookie(responseWriter, &http.Cookie{
		Name: middleware.AdminAccessCookieName, Value: session.AccessToken, Path: "/",
		Expires: session.AccessExpiresAt, HttpOnly: true, Secure: handler.secureCookies, SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(responseWriter, &http.Cookie{
		Name: middleware.AdminRefreshCookieName, Value: session.RefreshToken, Path: adminAuthCookiePath,
		Expires: session.RefreshExpiresAt, HttpOnly: true, Secure: handler.secureCookies, SameSite: http.SameSiteLaxMode,
	})
}

func (handler *AdminAuthHandler) clearSessionCookies(responseWriter http.ResponseWriter) {
	http.SetCookie(responseWriter, &http.Cookie{
		Name: middleware.AdminAccessCookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: handler.secureCookies, SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(responseWriter, &http.Cookie{
		Name: middleware.AdminRefreshCookieName, Value: "", Path: adminAuthCookiePath, MaxAge: -1,
		HttpOnly: true, Secure: handler.secureCookies, SameSite: http.SameSiteLaxMode,
	})
}
