package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

// AdminAnalyticsHandler relays the admin app's read screens to
// analytics-service and nothing else. It sums nothing, groups nothing and
// merges nothing: every aggregate the dashboard shows was computed in SQL
// inside analytics-service, which is the point of having a read model at all.
//
// It also publishes no domain-service subject. An admin page must wait on
// exactly two processes — auth (for the token) and analytics — never on
// universe, nature or dna, which on the free tier may be asleep. See
// agent-system/plans/services/analytics-service-plan.md#admin-request-path.
type AdminAnalyticsHandler struct {
	transport *RPCTransport
}

func NewAdminAnalyticsHandler(transport *RPCTransport) *AdminAnalyticsHandler {
	return &AdminAnalyticsHandler{transport: transport}
}

func (handler *AdminAnalyticsHandler) Overview(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AnalyticsOverviewQueryData{
		Family: familyFromQuery(request),
		Days:   intFromQuery(request, "days"),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsOverviewGetQuerySubject, data)
}

func (handler *AdminAnalyticsHandler) Timeseries(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AnalyticsTimeseriesQueryData{
		Family: familyFromQuery(request),
		Days:   intFromQuery(request, "days"),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsTimeseriesGetQuerySubject, data)
}

func (handler *AdminAnalyticsHandler) ListWorlds(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AnalyticsWorldListQueryData{
		PageQueryData: pageQueryFromRequest(request),
		Family:        familyFromQuery(request),
		Archetype:     strings.TrimSpace(request.URL.Query().Get("archetype")),
		WorldStyle:    strings.TrimSpace(request.URL.Query().Get("worldStyle")),
		Mood:          strings.TrimSpace(request.URL.Query().Get("mood")),
		Published:     boolFromQuery(request, "published"),
		Since:         timeFromQuery(request, "since"),
		Until:         timeFromQuery(request, "until"),
		Search:        searchFromQuery(request),
		// Relayed unvalidated, like every other filter here: the gateway does
		// not hold the rarity catalogue, and analytics-service already has to
		// decide what an unknown key means (nothing matches).
		RareFeature: strings.TrimSpace(request.URL.Query().Get("rareFeature")),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsWorldListQuerySubject, data)
}

// GetWorld relays one world by the id in the path. The id is passed through
// without validation for the same reason the filters above are: this handler
// is a relay, and analytics-service already has to decide what a valid world
// id is because it owns the column. Checking here would add a second opinion
// that can disagree with the first.
func (handler *AdminAnalyticsHandler) GetWorld(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AnalyticsWorldGetQueryData{
		WorldID: strings.TrimSpace(chi.URLParam(request, "worldID")),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsWorldGetQuerySubject, data)
}

func (handler *AdminAnalyticsHandler) ListJobs(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.AnalyticsJobListQueryData{
		PageQueryData: pageQueryFromRequest(request),
		Family:        familyFromQuery(request),
		Status:        contracts.JobStatus(strings.TrimSpace(request.URL.Query().Get("status"))),
		ErrorCode:     strings.TrimSpace(request.URL.Query().Get("errorCode")),
		Since:         timeFromQuery(request, "since"),
		Until:         timeFromQuery(request, "until"),
		Search:        searchFromQuery(request),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsJobListQuerySubject, data)
}

// ListServiceStarts relays the boot history. A pure relay like its
// neighbours: the gateway filters nothing and counts nothing, because the
// keyset page and the total are both SQL inside analytics-service.
//
// It sits with the analytics routes rather than with wake-stats even though
// both answer "what has the fleet been doing", because the two have opposite
// lifetimes. Wake statistics describe scale-to-zero hosting and are deleted
// with it; a restart happens on every platform, so this outlives the wake
// mechanism entirely.
func (handler *AdminAnalyticsHandler) ListServiceStarts(responseWriter http.ResponseWriter, request *http.Request) {
	data := contracts.ServiceStartListQueryData{
		PageQueryData: pageQueryFromRequest(request),
		Service:       strings.TrimSpace(request.URL.Query().Get("service")),
	}
	handler.relay(responseWriter, request, contracts.AnalyticsServiceStartListQuerySubject, data)
}

func (handler *AdminAnalyticsHandler) relay(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) {
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func familyFromQuery(request *http.Request) contracts.WorldFamily {
	return contracts.WorldFamily(strings.TrimSpace(request.URL.Query().Get("family")))
}

func intFromQuery(request *http.Request, name string) int {
	value, _ := strconv.Atoi(request.URL.Query().Get(name))
	return value
}

// boolFromQuery returns nil for an absent or unparseable value, so "no
// filter" stays distinguishable from "filter on false" — a missing
// ?published= must show every world, not only the unpublished ones.
func boolFromQuery(request *http.Request, name string) *bool {
	rawValue := strings.TrimSpace(request.URL.Query().Get(name))
	if rawValue == "" {
		return nil
	}
	parsed, err := strconv.ParseBool(rawValue)
	if err != nil {
		return nil
	}
	return &parsed
}

// timeFromQuery returns nil for an absent or unparseable value, so "no
// bound" stays distinguishable from a bound at the zero time — the same
// reasoning as boolFromQuery above. Callers send RFC3339.
func timeFromQuery(request *http.Request, name string) *time.Time {
	rawValue := strings.TrimSpace(request.URL.Query().Get(name))
	if rawValue == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, rawValue)
	if err != nil {
		return nil
	}
	return &parsed
}
