package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const invalidRequestJobID = "invalid-request"

type AuthService interface {
	Login(ctx context.Context, data contracts.LoginData, sourceAddress string) (contracts.LoginResponseData, error)
	Refresh(ctx context.Context, rawRefreshToken, sourceAddress string) (contracts.LoginResponseData, error)
	Logout(ctx context.Context, rawRefreshToken, sourceAddress string) error

	// The product audience's three own entry points. Logout is deliberately
	// absent: revoking the presented refresh token's family is the same act
	// for either audience, and the caller must already hold the token to ask,
	// so a per-audience variant would buy nothing. HandleWebLogoutQuery
	// answers its own subject and calls Logout above.
	SignUpEndUser(ctx context.Context, data contracts.WebSignupData) (contracts.LoginResponseData, error)
	LoginEndUser(ctx context.Context, data contracts.LoginData, sourceAddress string) (contracts.LoginResponseData, error)
	RefreshEndUserSession(ctx context.Context, rawRefreshToken, sourceAddress string) (contracts.LoginResponseData, error)
	// The account's own page. The account id on both is set by the gateway
	// from the access token, never read from the request body - see
	// contracts.AccountProfileGetData.
	AccountProfile(ctx context.Context, accountID string) (contracts.AccountProfileData, error)
	SaveAccountProfile(ctx context.Context, data contracts.AccountProfileUpdateData) (contracts.AccountProfileData, error)
	TokenVersion(ctx context.Context, accountID string) (int, error)
	DisableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error
	EnableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error

	InviteAccount(ctx context.Context, data contracts.InviteCreateData) (contracts.InviteCreateResponseData, error)
	AcceptInvite(ctx context.Context, data contracts.InviteAcceptData) (contracts.LoginResponseData, error)
	AccountPermissions(ctx context.Context, accountID string) (contracts.AccountPermissionsResponseData, error)
	ListAccounts(ctx context.Context, cursor string, pageSize int, search string, kind contracts.AccountKind) (contracts.AccountListResponseData, error)
	GetAccount(ctx context.Context, accountID string) (contracts.AccountSummary, error)
	CreateAccount(ctx context.Context, data contracts.AccountCreateData) (contracts.AccountSummary, error)
	UpdateAccount(ctx context.Context, data contracts.AccountUpdateData) (contracts.AccountSummary, error)

	ListRoles(ctx context.Context) (contracts.RoleListResponseData, error)
	CreateRole(ctx context.Context, data contracts.RoleCreateData) (contracts.RoleSummary, error)
	UpdateRole(ctx context.Context, data contracts.RoleUpdateData) (contracts.RoleSummary, error)
	DeleteRole(ctx context.Context, data contracts.RoleDeleteData) error
	AssignRole(ctx context.Context, data contracts.RoleAssignData) error
	RevokeRole(ctx context.Context, data contracts.RoleRevokeData) error

	ListPermissions(ctx context.Context) (contracts.PermissionListResponseData, error)
	ListAuditEvents(ctx context.Context, cursor string, pageSize int, since, until *time.Time, search string) (contracts.AuditListResponseData, error)
}

type ResponsePublisher interface {
	Publish(string, []byte) error
}

// NATSHandler owns auth-service's transport-specific request handling.
type NATSHandler struct {
	authService       AuthService
	responsePublisher ResponsePublisher
	queryTimeout      time.Duration
}

func NewNATSHandler(authService AuthService, responsePublisher ResponsePublisher, queryTimeout time.Duration) *NATSHandler {
	return &NATSHandler{authService: authService, responsePublisher: responsePublisher, queryTimeout: queryTimeout}
}

func (handler *NATSHandler) HandleLoginQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LoginData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.Login(ctx, envelope.Data, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleRefreshQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RefreshData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.Refresh(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleLogoutQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LogoutData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.Logout(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusNoContent, struct{}{}, err)
}

// HandleWebSignupQuery answers the one subject that can create an end-user
// account. A separate subject rather than a field on the admin one, so the
// staff/end-user separation is something a publisher cannot cross rather than
// something it must be trusted not to ask for - see the comment on
// contracts.AuthWebSignupQuerySubject.
func (handler *NATSHandler) HandleWebSignupQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.WebSignupData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.SignUpEndUser(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (handler *NATSHandler) HandleWebLoginQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LoginData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.LoginEndUser(ctx, envelope.Data, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleWebRefreshQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RefreshData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.RefreshEndUserSession(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

// HandleWebLogoutQuery serves the product's own subject with the shared
// Logout: see the AuthService interface for why logout has no per-audience
// variant behind it.
func (handler *NATSHandler) HandleWebLogoutQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LogoutData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.Logout(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusNoContent, struct{}{}, err)
}

// HandleWebProfileGetQuery and HandleWebProfileUpdateQuery answer the
// account's own page. Neither reads an account id from anywhere but
// envelope.Data.AccountID, which the gateway sets from the access token's
// subject: an id a caller could name is an id a caller could name somebody
// else's.
func (handler *NATSHandler) HandleWebProfileGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountProfileGetData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountProfileData, error) {
		return handler.authService.AccountProfile(ctx, envelope.Data.AccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleWebProfileUpdateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountProfileUpdateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountProfileData, error) {
		return handler.authService.SaveAccountProfile(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleTokenVersionQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.TokenVersionQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.TokenVersionResponseData, error) {
		tokenVersion, err := handler.authService.TokenVersion(ctx, envelope.Data.AccountID)
		return contracts.TokenVersionResponseData{TokenVersion: tokenVersion}, err
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountDisableQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountDisableData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.DisableAccount(ctx, envelope.Data.AccountID, envelope.Data.ActorAccountID, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandleAccountEnableQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountEnableData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.EnableAccount(ctx, envelope.Data.AccountID, envelope.Data.ActorAccountID, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandleInviteCreateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.InviteCreateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.InviteCreateResponseData, error) {
		return handler.authService.InviteAccount(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (handler *NATSHandler) HandleInviteAcceptQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.InviteAcceptData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.AcceptInvite(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountPermissionsQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountPermissionsQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountPermissionsResponseData, error) {
		return handler.authService.AccountPermissions(ctx, envelope.Data.AccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountListResponseData, error) {
		return handler.authService.ListAccounts(ctx, envelope.Data.Cursor, envelope.Data.PageSize, envelope.Data.Search, envelope.Data.Kind)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountGetQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountSummary, error) {
		return handler.authService.GetAccount(ctx, envelope.Data.AccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountCreateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountCreateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountSummary, error) {
		return handler.authService.CreateAccount(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (handler *NATSHandler) HandleAccountUpdateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountUpdateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AccountSummary, error) {
		return handler.authService.UpdateAccount(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleRoleListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[struct{}]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.RoleListResponseData, error) {
		return handler.authService.ListRoles(ctx)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleRoleCreateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RoleCreateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.RoleSummary, error) {
		return handler.authService.CreateRole(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (handler *NATSHandler) HandleRoleUpdateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RoleUpdateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.RoleSummary, error) {
		return handler.authService.UpdateRole(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleRoleDeleteQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RoleDeleteData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.DeleteRole(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandleRoleAssignQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RoleAssignData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.AssignRole(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandleRoleRevokeQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RoleRevokeData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.RevokeRole(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandlePermissionListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[struct{}]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.PermissionListResponseData, error) {
		return handler.authService.ListPermissions(ctx)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAuditListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AuditListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AuditListResponseData, error) {
		return handler.authService.ListAuditEvents(ctx, envelope.Data.Cursor, envelope.Data.PageSize, envelope.Data.Since, envelope.Data.Until, envelope.Data.Search)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func asRoleInUseError(err error) *services.RoleInUseError {
	var roleInUseError *services.RoleInUseError
	if errors.As(err, &roleInUseError) {
		return roleInUseError
	}
	return nil
}

func decodeEnvelope[DataType any](payload []byte, envelope *contracts.Envelope[DataType]) error {
	if err := json.Unmarshal(payload, envelope); err != nil {
		return err
	}
	return envelope.Validate()
}

func decodeQuery[DataType any](handler *NATSHandler, message *nats.Msg, envelope *contracts.Envelope[DataType]) bool {
	if strings.TrimSpace(message.Reply) == "" {
		return false
	}
	if err := decodeEnvelope(message.Data, envelope); err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(invalidRequestJobID, http.StatusBadRequest, "INVALID_REQUEST", "The internal request is invalid."))
		return false
	}
	return true
}

func withQueryTimeout[ResponseType any](handler *NATSHandler, query func(context.Context) (ResponseType, error)) (ResponseType, error) {
	queryContext, cancel := context.WithTimeout(context.Background(), handler.queryTimeout)
	defer cancel()
	return query(queryContext)
}

func (handler *NATSHandler) respondWithResult(message *nats.Msg, jobID string, successStatus int, payload any, err error) {
	switch {
	case errors.Is(err, repositories.ErrNotFound):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found."))
	case errors.Is(err, repositories.ErrConflict):
		// ErrConflict does not say which unique constraint fired (invite
		// email, role name, ...), so this message stays generic rather than
		// guessing the field. Without this case the switch fell through to
		// the generic 500 below, turning "you already invited this email"
		// into an opaque INTERNAL_ERROR for the caller.
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "CONFLICT", "A resource with these details already exists."))
	case errors.Is(err, services.ErrInvalidCredentials):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Incorrect email or password."))
	case errors.Is(err, services.ErrAccountDisabled):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "ACCOUNT_DISABLED", "This account has been disabled."))
	case errors.Is(err, services.ErrAccountLocked):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "ACCOUNT_LOCKED", "This account is temporarily locked. Try again later."))
	case errors.Is(err, services.ErrInvalidRefreshToken):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "The session is no longer valid. Please log in again."))
	case errors.Is(err, services.ErrLastSuperAdmin):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "LAST_SUPER_ADMIN", "The last super admin account cannot be disabled."))
	case errors.Is(err, services.ErrInvalidInviteToken):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusUnauthorized, "INVALID_INVITE_TOKEN", "This invite link is invalid or has expired."))
	case errors.Is(err, services.ErrPasswordTooShort):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusBadRequest, "PASSWORD_TOO_SHORT", "The password must be at least 12 characters."))
	case errors.Is(err, repositories.ErrRoleNotGrantableToAccountKind):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "ROLE_NOT_GRANTABLE", "A role can only be granted to a staff account."))
	case errors.Is(err, services.ErrPasswordBreached):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusBadRequest, "PASSWORD_BREACHED", "This password has appeared in a public data breach. Please choose a different one."))
	case errors.Is(err, services.ErrEmailRequired):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusBadRequest, "VALIDATION_ERROR", "An email address is required."))
	case errors.Is(err, services.ErrProfileInvalid):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusBadRequest, "VALIDATION_ERROR", "Please check the highlighted fields."))
	case errors.Is(err, services.ErrProfileNotForStaff):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "PROFILE_NOT_AVAILABLE", "This account has no product profile."))
	case errors.Is(err, services.ErrDisplayNameTooLong):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusBadRequest, "VALIDATION_ERROR", fmt.Sprintf("A display name can be at most %d characters.", contracts.MaximumAccountDisplayNameLength)))
	case errors.Is(err, services.ErrEmailUnavailable):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "EMAIL_UNAVAILABLE", "That email address cannot be used. If you already have an account, sign in instead."))
	case errors.Is(err, services.ErrSystemRoleImmutable):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "SYSTEM_ROLE_IMMUTABLE", "System roles cannot be edited or deleted."))
	case errors.Is(err, services.ErrSelfRevokeForbidden):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "SELF_REVOKE_FORBIDDEN", "You cannot revoke your own account:manage or role:manage permission."))
	case asRoleInUseError(err) != nil:
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "ROLE_IN_USE", asRoleInUseError(err).Error()))
	case err != nil:
		log.Error().Err(err).Str("request_id", jobID).Msg("auth query failed")
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The request could not be completed."))
	default:
		responseEnvelope, marshalError := contracts.SuccessRPCEnvelope(jobID, successStatus, payload)
		if marshalError != nil {
			handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
			return
		}
		handler.respond(message, responseEnvelope)
	}
}

func (handler *NATSHandler) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal auth NATS response")
		return
	}
	if err := handler.responsePublisher.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish auth NATS response")
	}
}
