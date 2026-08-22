package handlers

import (
	"net/http"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

// AdminTelemetryHandler relays the admin app's Telemetry screen to
// telemetry-service and nothing else, exactly as AdminAnalyticsHandler does
// for the business screens.
//
// It sums nothing, interpolates no percentile and decides nothing about which
// sink answered. Every number the screen shows was computed inside
// telemetry-service, which is the point of having a read model at all - and
// the reason a gateway that also aggregated would have two implementations of
// the same statistic to keep in agreement.
//
// It also publishes no domain-service subject. A Telemetry page waits on
// exactly two processes, auth (for the token) and telemetry, never on
// universe, nature or dna.
type AdminTelemetryHandler struct {
	transport *RPCTransport
}

func NewAdminTelemetryHandler(transport *RPCTransport) *AdminTelemetryHandler {
	return &AdminTelemetryHandler{transport: transport}
}

func (handler *AdminTelemetryHandler) Overview(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.TelemetryOverviewQueryData{
		Hours: intFromQuery(request, "hours"),
	}
	handler.relay(responseWriter, request, contracts.TelemetryOverviewGetQuerySubject, data)
}

func (handler *AdminTelemetryHandler) ListRoutes(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.TelemetryRouteListQueryData{
		Hours: intFromQuery(request, "hours"),
	}
	handler.relay(responseWriter, request, contracts.TelemetryRouteListQuerySubject, data)
}

// relay passes the window through unclamped. telemetry-service applies
// NormalizeTelemetryHours because it owns the tables the bound protects; a
// second opinion here could only ever disagree with the first.
func (handler *AdminTelemetryHandler) relay(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) {
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}
