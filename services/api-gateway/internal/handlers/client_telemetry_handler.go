package handlers

import (
	"net/http"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/telemetry"
)

// ClientTelemetryHandler accepts what a browser resolved for itself.
//
// It is the only route in this gateway whose body becomes a number the
// platform reports about itself, filled by a caller nobody authenticated. Four
// things keep that safe, and none of them is trust:
//
//  1. Every field is a closed set, validated by
//     contracts.ClientRenderReportData.Validate. A value outside it is refused
//     rather than clamped, because a clamped value would enter the platform's
//     own numbers as a fact.
//  2. There is no count. One request is one render. A caller that could send
//     its own count could move a chart with a single request instead of a
//     rate-limited many.
//  3. The key space is 24 combinations, so no caller can create a series —
//     only add to one that already exists.
//  4. The route sits on the product surface, behind that group's per-IP token
//     bucket in Redis and its body limit.
//
// What remains possible is inflation: somebody determined can add to these
// counters. The screen that renders them says they are client-reported for
// exactly that reason, and no decision keyed to real money or real access
// depends on them.
type ClientTelemetryHandler struct {
	collector *telemetry.Collector
}

func NewClientTelemetryHandler(collector *telemetry.Collector) *ClientTelemetryHandler {
	return &ClientTelemetryHandler{collector: collector}
}

// Report answers 204 and never a body.
//
// The caller is a page that has already rendered — or failed to — and has
// nothing to do with the answer. A `sendBeacon` call cannot read a response at
// all, and a JSON body here would only be parsed by nobody.
//
// A malformed report is a 400 rather than a silent 204. It costs the visitor
// nothing either way, but a silent accept would let the frontend ship a
// renamed field and take months to notice that a chart had quietly gone flat.
func (handler *ClientTelemetryHandler) Report(responseWriter http.ResponseWriter, request *http.Request) {
	var report contracts.ClientRenderReportData
	if !decodeJSONBody(responseWriter, request, &report) {
		return
	}
	if err := report.Validate(); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_RENDER_REPORT", err.Error())
		return
	}
	// Nil whenever TELEMETRY_ENABLED is off, and RecordClientRender is a no-op
	// on nil — so the route answers 204 with telemetry off rather than 500,
	// which is what keeps the frontend from needing to know whether the
	// platform is currently counting.
	handler.collector.RecordClientRender(report.QualityTier, report.Family, report.Outcome)
	responseWriter.WriteHeader(http.StatusNoContent)
}
