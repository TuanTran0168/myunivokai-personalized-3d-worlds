package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

type AdminRolesHandler struct {
	transport *RPCTransport
}

func NewAdminRolesHandler(transport *RPCTransport) *AdminRolesHandler {
	return &AdminRolesHandler{transport: transport}
}

func (handler *AdminRolesHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleListQuerySubject, struct{}{})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminRolesHandler) Create(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Name        string                    `json:"name"`
		Description string                    `json:"description"`
		Audience    contracts.AccountAudience `json:"audience"`
		Permissions []string                  `json:"permissions"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleCreateQuerySubject, contracts.RoleCreateData{
		Name: body.Name, Description: body.Description, Audience: body.Audience, Permissions: body.Permissions,
		ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminRolesHandler) Update(responseWriter http.ResponseWriter, request *http.Request) {
	roleID := chi.URLParam(request, "roleID")
	var body struct {
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleUpdateQuerySubject, contracts.RoleUpdateData{
		RoleID: roleID, Description: body.Description, Permissions: body.Permissions,
		ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminRolesHandler) Delete(responseWriter http.ResponseWriter, request *http.Request) {
	roleID := chi.URLParam(request, "roleID")
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleDeleteQuerySubject, contracts.RoleDeleteData{
		RoleID: roleID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminRolesHandler) Assign(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		AccountID string `json:"accountId"`
		RoleID    string `json:"roleId"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleAssignQuerySubject, contracts.RoleAssignData{
		AccountID: body.AccountID, RoleID: body.RoleID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminRolesHandler) Revoke(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		AccountID string `json:"accountId"`
		RoleID    string `json:"roleId"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthRoleRevokeQuerySubject, contracts.RoleRevokeData{
		AccountID: body.AccountID, RoleID: body.RoleID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}
