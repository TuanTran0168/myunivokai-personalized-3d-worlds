package handlers

import (
	"net/http"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

type AdminPermissionsHandler struct {
	transport *RPCTransport
}

func NewAdminPermissionsHandler(transport *RPCTransport) *AdminPermissionsHandler {
	return &AdminPermissionsHandler{transport: transport}
}

func (handler *AdminPermissionsHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthPermissionListQuerySubject, struct{}{})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

type AdminAuditHandler struct {
	transport *RPCTransport
}

func NewAdminAuditHandler(transport *RPCTransport) *AdminAuditHandler {
	return &AdminAuditHandler{transport: transport}
}

func (handler *AdminAuditHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AuditListQueryData{
		PageQueryData: pageQueryFromRequest(request),
		Since:         timeFromQuery(request, "since"),
		Until:         timeFromQuery(request, "until"),
		Search:        searchFromQuery(request),
	}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAuditListQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}
