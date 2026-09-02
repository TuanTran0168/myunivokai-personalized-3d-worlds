package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
	"github.com/rs/zerolog/log"
)

// maximumEmailAddressLength is the practical ceiling from RFC 5321's 254-octet
// limit on a forward path. Enforced at the edge so an oversized address never
// reaches a database column or a Redis key.
const maximumEmailAddressLength = 254

// IdentityFailureCounter is the per-email throttle's storage. It is a separate
// interface from DistributedLimiter on purpose: that one is per-IP and lives
// in a middleware, this one is per-identity and can only live in the handler,
// because the identity is in the request BODY and a middleware would have to
// read and rewind it to see one.
type IdentityFailureCounter interface {
	RecordIdentityFailure(ctx context.Context, identityKey string, window time.Duration) (int, error)
	IdentityFailureCount(ctx context.Context, identityKey string) (int, error)
	ClearIdentityFailures(ctx context.Context, identityKey string) error
}

type productCredentialsRequestBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// productSignUpRequestBody is the credentials plus the display name the person
// chose. A separate type from productCredentialsRequestBody rather than a
// `name` added to it, so LOGIN's accepted body shape is unchanged: a login
// that quietly accepted a name would be a field with no meaning on the one
// request where somebody might expect it to identify them.
type productSignUpRequestBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type productRefreshRequestBody struct {
	RefreshToken string `json:"refreshToken"`
}

// productAccountBody is deliberately narrower than contracts.AccountSummary.
// Roles, permissions, isSuperAdmin, kind, disabled and forcePasswordChange
// are all omitted, and the omission is the design: an end-user account holds
// none of them, and a client that can read them is a client that will
// eventually decide something with them. The plan's §15 rule against taking
// an authorization decision from a read model applies to the client too.
type productAccountBody struct {
	AccountID string    `json:"accountId"`
	Email     string    `json:"email"`
	Name      string    `json:"name,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// productSessionResponseBody carries the tokens IN THE BODY, which is the
// opposite of sessionResponseBody's rule for the admin session and is correct
// for the same underlying reason: the admin app and the gateway are same-site
// so a cookie works and httpOnly is available, while the web app and the
// gateway are two different sites so a session cookie would need
// SameSite=None and fail silently on iPhones (plan §4.1's table).
//
// The client puts accessToken into an Authorization header by hand, which is
// why this design has no CSRF surface at all (§4.3). Where the client KEEPS
// the value is its own decision and the gateway sets no cookie either way.
type productSessionResponseBody struct {
	AccessToken      string             `json:"accessToken"`
	AccessExpiresAt  time.Time          `json:"accessExpiresAt"`
	RefreshToken     string             `json:"refreshToken"`
	RefreshExpiresAt time.Time          `json:"refreshExpiresAt"`
	Account          productAccountBody `json:"account"`
}

// ProductAuthHandler answers /api/auth and /api/me. It shares RPCTransport
// with every other handler but never Proxy: a session response must never be
// written into the Redis response cache.
type ProductAuthHandler struct {
	transport             *RPCTransport
	identityFailures      IdentityFailureCounter
	identityFailureLimit  int
	identityFailureWindow time.Duration
}

func NewProductAuthHandler(serviceConfig config.Config, transport *RPCTransport, identityFailures IdentityFailureCounter) *ProductAuthHandler {
	return &ProductAuthHandler{
		transport:             transport,
		identityFailures:      identityFailures,
		identityFailureLimit:  serviceConfig.IdentityFailureLimit(),
		identityFailureWindow: serviceConfig.IdentityFailureWindow(),
	}
}

func (handler *ProductAuthHandler) SignUp(responseWriter http.ResponseWriter, request *http.Request) {
	var body productSignUpRequestBody
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	body.Email = strings.TrimSpace(body.Email)
	if !handler.credentialsAreUsable(responseWriter, request, body.Email, body.Password) {
		return
	}
	displayName := strings.TrimSpace(body.Name)
	// Runes, not bytes, and the same count auth-service enforces — see
	// contracts.MaximumAccountDisplayNameLength. The edge check exists to give
	// the caller a message naming the limit; auth-service's is the invariant.
	if len([]rune(displayName)) > contracts.MaximumAccountDisplayNameLength {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", fmt.Sprintf("A display name can be at most %d characters.", contracts.MaximumAccountDisplayNameLength))
		return
	}
	// Signup is not throttled per email, and that is not an oversight: the
	// counter exists to slow guessing at a password for an account that
	// exists, and a signup has no password to guess. Throttling it per address
	// would only let someone stop a stranger from ever registering an address
	// by attempting it themselves.
	handler.completeSession(responseWriter, request, http.StatusCreated, contracts.AuthWebSignupQuerySubject, contracts.WebSignupData{
		Email: body.Email, Name: displayName, Password: body.Password, SourceAddress: httpx.ClientIP(request.Context()),
	})
}

func (handler *ProductAuthHandler) LogIn(responseWriter http.ResponseWriter, request *http.Request) {
	body, ok := handler.decodeCredentials(responseWriter, request)
	if !ok {
		return
	}
	identityKey := edge.IdentityFailureKey(body.Email)
	if handler.identityIsThrottled(request.Context(), identityKey) {
		// 429 and not 401, because the two mean different things to a person
		// looking at the form: one says the password was wrong, the other says
		// stop for a while. Answering 401 here would also make the throttle
		// invisible and therefore untestable from outside.
		httpx.WriteError(responseWriter, request, http.StatusTooManyRequests, "TOO_MANY_ATTEMPTS", "Too many sign-in attempts for this account. Please wait a few minutes and try again.")
		return
	}
	statusRecorder := &sessionStatusWriter{ResponseWriter: responseWriter}
	handler.completeSession(statusRecorder, request, http.StatusOK, contracts.AuthWebLoginQuerySubject, contracts.LoginData{
		Email: body.Email, Password: body.Password, SourceAddress: httpx.ClientIP(request.Context()),
	})
	handler.recordSignInOutcome(request.Context(), identityKey, statusRecorder.status)
}

func (handler *ProductAuthHandler) Refresh(responseWriter http.ResponseWriter, request *http.Request) {
	var body productRefreshRequestBody
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	if strings.TrimSpace(body.RefreshToken) == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "A refresh token is required.")
		return
	}
	handler.completeSession(responseWriter, request, http.StatusOK, contracts.AuthWebRefreshQuerySubject, contracts.RefreshData{
		RefreshToken: body.RefreshToken, SourceAddress: httpx.ClientIP(request.Context()),
	})
}

// LogOut revokes the presented token's whole rotation family. It takes the
// token in the body rather than reading a session, so signing out works from
// a client whose access token has already expired — the state a 7-day access
// token and a 3-month refresh token make ordinary.
func (handler *ProductAuthHandler) LogOut(responseWriter http.ResponseWriter, request *http.Request) {
	var body productRefreshRequestBody
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	if strings.TrimSpace(body.RefreshToken) == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "A refresh token is required.")
		return
	}
	if _, ok := handler.transport.Request(responseWriter, request, contracts.AuthWebLogoutQuerySubject, contracts.LogoutData{
		RefreshToken: body.RefreshToken, SourceAddress: httpx.ClientIP(request.Context()),
	}); !ok {
		return
	}
	responseWriter.WriteHeader(http.StatusNoContent)
}

// Me answers with the signed-in account, read for the SUBJECT IN THE TOKEN
// and never for an id in the path or the query — which is why there is no
// authorization check beyond RequireProductAccessToken: a caller cannot name
// an account other than its own.
//
// It reaches auth-service, which sleeps, so the web app must not call it on
// every page load: the account it needs is already in the session response it
// stored at sign-in. This route exists to re-read an account on demand (the
// account menu, a settings screen), and the plan's §11 wake budget assumes a
// signed-in visitor browsing worlds wakes auth-service not at all.
func (handler *ProductAuthHandler) Me(responseWriter http.ResponseWriter, request *http.Request) {
	claims, present := middleware.ProductClaims(request.Context())
	if !present {
		// Unreachable through the router, which is the point of asserting it:
		// this handler cannot be mounted without RequireProductAccessToken and
		// silently serve somebody else's account.
		httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid session is required.")
		return
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountGetQuerySubject, contracts.AccountGetQueryData{
		AccountID: claims.Subject,
	})
	if !ok {
		return
	}
	var account contracts.AccountSummary
	if err := json.Unmarshal(response.Data.Payload, &account); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
		return
	}
	httpx.WriteJSON(responseWriter, http.StatusOK, toProductAccountBody(account))
}

func (handler *ProductAuthHandler) completeSession(responseWriter http.ResponseWriter, request *http.Request, successStatus int, subject string, data any) {
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	var session contracts.LoginResponseData
	if err := json.Unmarshal(response.Data.Payload, &session); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
		return
	}
	httpx.WriteJSON(responseWriter, successStatus, productSessionResponseBody{
		AccessToken:      session.AccessToken,
		AccessExpiresAt:  session.AccessExpiresAt,
		RefreshToken:     session.RefreshToken,
		RefreshExpiresAt: session.RefreshExpiresAt,
		Account:          toProductAccountBody(session.Account),
	})
}

// decodeCredentials validates the shape of an email/password pair. Format is
// checked here, at the edge, because this is the only layer with a caller to
// report it to; auth-service enforces the invariants that must hold whoever
// publishes the query (see its ErrEmailRequired).
func (handler *ProductAuthHandler) decodeCredentials(responseWriter http.ResponseWriter, request *http.Request) (productCredentialsRequestBody, bool) {
	var body productCredentialsRequestBody
	if !decodeJSONBody(responseWriter, request, &body) {
		return body, false
	}
	body.Email = strings.TrimSpace(body.Email)
	if !handler.credentialsAreUsable(responseWriter, request, body.Email, body.Password) {
		return body, false
	}
	return body, true
}

// credentialsAreUsable holds the email and password rules shared by sign-up
// and sign-in, and writes the rejection itself so the two paths cannot answer
// the same bad input differently. Signup has its own decode because its body
// carries a display name; the rules below are the part that must not fork.
func (handler *ProductAuthHandler) credentialsAreUsable(responseWriter http.ResponseWriter, request *http.Request, emailAddress, password string) bool {
	if emailAddress == "" || password == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email and password are required.")
		return false
	}
	if !isPlausibleEmailAddress(emailAddress) {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "That does not look like an email address.")
		return false
	}
	return true
}

func (handler *ProductAuthHandler) identityIsThrottled(ctx context.Context, identityKey string) bool {
	failureCount, err := handler.identityFailures.IdentityFailureCount(ctx, identityKey)
	if err != nil {
		// Redis being unreachable must not stop people signing in. The per-IP
		// bucket has a local fallback limiter for the same reason, and
		// auth-service's own account lockout is the last line and is in
		// Postgres, so failing open here loses one layer rather than all of
		// them.
		log.Warn().Err(err).Msg("read identity failure count; allowing the sign-in attempt")
		return false
	}
	return failureCount >= handler.identityFailureLimit
}

// recordSignInOutcome counts a rejected credential and clears the tally on a
// success. Only 401 counts: a 400 is a malformed request, a 429 was already
// throttled, and a 503 is auth-service being cold — counting the last one
// would let a cold start lock somebody out of their own account.
func (handler *ProductAuthHandler) recordSignInOutcome(ctx context.Context, identityKey string, status int) {
	switch status {
	case http.StatusUnauthorized:
		if _, err := handler.identityFailures.RecordIdentityFailure(ctx, identityKey, handler.identityFailureWindow); err != nil {
			log.Warn().Err(err).Msg("record identity failure")
		}
	case http.StatusOK:
		if err := handler.identityFailures.ClearIdentityFailures(ctx, identityKey); err != nil {
			log.Warn().Err(err).Msg("clear identity failures after a successful sign-in")
		}
	}
}

func toProductAccountBody(account contracts.AccountSummary) productAccountBody {
	return productAccountBody{
		AccountID: account.AccountID,
		Email:     account.Email,
		Name:      account.Name,
		CreatedAt: account.CreatedAt,
	}
}

// isPlausibleEmailAddress uses net/mail rather than a regular expression, and
// then insists the parsed address is the whole input: mail.ParseAddress
// accepts `Display Name <a@b.example>`, which is a valid address in a mail
// header and not a thing anybody should be able to register as a login.
func isPlausibleEmailAddress(candidate string) bool {
	if len(candidate) > maximumEmailAddressLength {
		return false
	}
	parsed, err := mail.ParseAddress(candidate)
	return err == nil && parsed.Address == candidate && parsed.Name == ""
}

// sessionStatusWriter captures the status the sign-in produced so the
// per-email counter can be updated after the fact. The wrapper is duplicated
// from middleware.telemetryStatusWriter rather than shared, for the reason
// that one already records about Logging's copy: the two have independent
// lifetimes, and coupling them for a single int is not worth it.
type sessionStatusWriter struct {
	http.ResponseWriter
	status int
}

func (writer *sessionStatusWriter) WriteHeader(status int) {
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *sessionStatusWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}
