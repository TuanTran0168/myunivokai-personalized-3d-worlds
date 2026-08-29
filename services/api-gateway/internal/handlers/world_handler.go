package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/oklog/ulid/v2"
	"github.com/rs/zerolog/log"
)

const maximumBatchWorldIdentifiers = 50

type GenerationPublisher interface {
	PublishGeneration(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error
}

type worldSubjects struct {
	worldList     string
	worldGet      string
	variantCreate string
	variantSelect string
	worldPublish  string
	shareGet      string
}

// WorldHandler implements one fixed world-family route set. Family-to-subject
// routing is constructor-owned, so request data can never select another service.
type WorldHandler struct {
	family   contracts.WorldFamily
	subjects worldSubjects
	// familyService names the service that answers this handler's subjects,
	// for the proactive wake in CreateWorld. It is derived from a subject
	// rather than from the family string so that the two never drift apart -
	// and derived once, here, because family-to-subject routing is
	// constructor-owned throughout this type.
	familyService        string
	generationPublisher  GenerationPublisher
	transport            *RPCTransport
	publishTimeout       time.Duration
	worldCacheTimeToLive time.Duration
	shareCacheTimeToLive time.Duration
}

func newWorldHandler(serviceConfig config.Config, family contracts.WorldFamily, subjects worldSubjects, generationPublisher GenerationPublisher, transport *RPCTransport) *WorldHandler {
	return &WorldHandler{
		family: family, subjects: subjects, familyService: wake.ServiceForSubject(subjects.worldGet),
		generationPublisher: generationPublisher, transport: transport,
		publishTimeout: serviceConfig.NATSPublishTimeout, worldCacheTimeToLive: serviceConfig.WorldCacheTimeToLive,
		shareCacheTimeToLive: serviceConfig.ShareCacheTimeToLive,
	}
}

func (handler *WorldHandler) CreateWorld(responseWriter http.ResponseWriter, request *http.Request) {
	var input contracts.WorldInput
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must be valid JSON.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must contain one JSON object.")
		return
	}
	input = input.Normalize()
	if details := input.Validate(); len(details) > 0 {
		httpx.WriteErrorWithDetails(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Please check the highlighted fields.", details)
		return
	}
	// Wake before publishing, not after a failure, because this path never
	// produces a failure to react to: a JetStream publish succeeds whether or
	// not any consumer is alive, so a POST against a sleeping fleet returns
	// 202, the job sits at `queued`, and every HTTP response in the trace is a
	// success. There is no error for reactive waking to hang off - see
	// agent-system/plans/architecture/service-wake-mechanism.md#design-proactive-wake-on-write-reactive-wake-on-read.
	//
	// Both services are woken because this one job needs both in sequence:
	// dna-service to generate the profile, then the family service to compose
	// the world. Waking them together overlaps two cold starts instead of
	// paying for them one after the other.
	handler.transport.Wake(wake.ServiceDNA)
	handler.transport.Wake(handler.familyService)
	jobID := ulid.Make().String()
	createdAt := time.Now().UTC()
	job := contracts.Job{JobID: jobID, Family: handler.family, Status: contracts.JobStatusQueued, CreatedAt: createdAt, UpdatedAt: createdAt}
	publishContext, cancel := context.WithTimeout(request.Context(), handler.publishTimeout)
	defer cancel()
	command := contracts.NewEnvelope(jobID, contracts.GenerateDNAData{Family: handler.family, Input: input})
	if err := handler.generationPublisher.PublishGeneration(publishContext, command); err != nil {
		log.Error().Err(err).Str("request_id", httpx.RequestID(request.Context())).Msg("publish generation command")
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "GENERATION_UNAVAILABLE", "Generation could not be accepted right now.")
		return
	}
	handler.wakeReadModel()
	httpx.WriteJSON(responseWriter, http.StatusAccepted, job)
}

func (handler *WorldHandler) GetWorlds(responseWriter http.ResponseWriter, request *http.Request) {
	rawWorldIdentifiers := request.URL.Query().Get("ids")
	if strings.TrimSpace(rawWorldIdentifiers) == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provide ids as a comma-separated list of world IDs.")
		return
	}
	worldIdentifiers := splitIdentifiers(rawWorldIdentifiers)
	if len(worldIdentifiers) > maximumBatchWorldIdentifiers {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", fmt.Sprintf("Too many ids; request at most %d worlds per call.", maximumBatchWorldIdentifiers))
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.worldList, contracts.WorldListQueryData{WorldIDs: worldIdentifiers}, cachePolicy{})
}

func (handler *WorldHandler) GetWorld(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	cacheIdentifier := edge.WorldCacheIdentifier(string(handler.family), worldID)
	if handler.transport.WriteCacheHit(responseWriter, request, worldCacheNamespace, cacheIdentifier) {
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.worldGet, contracts.WorldQueryData{WorldID: worldID}, cachePolicy{
		namespace: worldCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.worldCacheTimeToLive,
	})
}

func (handler *WorldHandler) CreateVariant(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.variantCreate, contracts.VariantCreateData{WorldID: worldID})
}

func (handler *WorldHandler) SelectVariant(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	variantID := chi.URLParam(request, "variantID")
	if _, err := uuid.Parse(variantID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.variantSelect, contracts.VariantSelectData{WorldID: worldID, VariantID: variantID})
}

func (handler *WorldHandler) PublishWorld(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.worldPublish, contracts.PublishWorldData{WorldID: worldID})
}

func (handler *WorldHandler) GetShare(responseWriter http.ResponseWriter, request *http.Request) {
	shareSlug := chi.URLParam(request, "shareSlug")
	cacheIdentifier := edge.ShareCacheIdentifier(string(handler.family), shareSlug)
	if handler.transport.WriteCacheHit(responseWriter, request, shareCacheNamespace, cacheIdentifier) {
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.shareGet, contracts.ShareQueryData{ShareSlug: shareSlug}, cachePolicy{
		namespace: shareCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.shareCacheTimeToLive,
	})
}

// Invalidate before and after a mutation to close the concurrent stale-fill race.
//
// The share cache can only be dropped AFTER the call: it is keyed by share slug,
// which the gateway does not know from a world id, so every mutation response
// carries `shareSlug` back for this. Selecting a different variant changes what
// the public share page renders, and without this the share served the previous
// variant for a whole cache TTL — long enough for a seed-derived rare feature to
// appear on the dashboard and be missing from the shared link.
func (handler *WorldHandler) proxyWorldMutation(responseWriter http.ResponseWriter, request *http.Request, worldID, subject string, data any) {
	handler.transport.InvalidateWorld(request.Context(), handler.family, worldID)
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	handler.transport.InvalidateWorld(request.Context(), handler.family, worldID)
	handler.transport.InvalidateShare(request.Context(), handler.family, shareSlugFromMutationPayload(response.Data.Payload))
	handler.wakeReadModel()
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// wakeReadModel starts analytics-service because this request has just created
// an event for it to consume.
//
// Without it the read model can miss events permanently, and say nothing. It
// wakes only when somebody opens the admin console, MYUNIVOKAI_EVENTS retains
// seven days, and its durable consumer is the only thing that advances the
// projection - so a week with no staff visit expires the oldest events
// UNCONSUMED. The world and job counts are then wrong forever, with no error in
// any log, because a message that aged out of a stream is not a failure anybody
// observes. See agent-system/evolution/platform-evolution-research.md#the-retention-trap
// --and-it-applies-to-library-service-too, which names this a defect in the
// system as it runs today rather than a risk in a proposal.
//
// Reactive waking cannot reach this case for the same reason CreateWorld wakes
// proactively: analytics-service is never the responder for any request a
// client makes here, so no no-responders reply exists to hang a wake off. The
// gateway is the only process that is awake by definition at the moment an
// event is produced, which is what makes this the one place the call can go.
//
// Called AFTER the write has been accepted, unlike the two wakes in
// CreateWorld, and the difference is deliberate. Those two overlap cold starts
// on the critical path, so they fire before the publish. This one is not on any
// critical path - the read model has hours to catch up, not milliseconds - so
// firing it only once an event provably exists keeps a burst of rejected
// requests from becoming a burst of outbound calls.
//
// What this does NOT cover, stated rather than implied: an event nobody asked
// the gateway for. A service announcing its own boot on
// service.started.v1 can still expire unconsumed if the fleet restarts during a
// week with no staff visit. That costs a row of fleet history, not a wrong
// world count, and covering it would mean waking the read model on every wake
// of every service - which is most of a scale-to-zero budget spent on a
// dashboard nobody has opened.
func (handler *WorldHandler) wakeReadModel() {
	handler.transport.Wake(wake.ServiceAnalytics)
}

// shareSlugFromMutationPayload peeks at the one field the gateway needs without
// taking on the shape of any service's response model. Publish already returns
// the slug at the root; variant mutations now do too. A payload without it (or
// an unpublished world) yields "", which InvalidateShare treats as a no-op.
func shareSlugFromMutationPayload(payload []byte) string {
	var mutation struct {
		ShareSlug string `json:"shareSlug"`
	}
	if err := json.Unmarshal(payload, &mutation); err != nil {
		return ""
	}
	return mutation.ShareSlug
}

func worldIdentifierFromRequest(responseWriter http.ResponseWriter, request *http.Request) (string, bool) {
	worldID := chi.URLParam(request, "worldID")
	if _, err := uuid.Parse(worldID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return "", false
	}
	return worldID, true
}

func splitIdentifiers(rawIdentifiers string) []string {
	parts := strings.Split(rawIdentifiers, ",")
	identifiers := make([]string, 0, len(parts))
	seenIdentifiers := make(map[string]struct{})
	for _, part := range parts {
		identifier := strings.TrimSpace(part)
		if identifier == "" {
			continue
		}
		if _, found := seenIdentifiers[identifier]; found {
			continue
		}
		seenIdentifiers[identifier] = struct{}{}
		if _, err := uuid.Parse(identifier); err != nil {
			continue
		}
		identifiers = append(identifiers, identifier)
	}
	return identifiers
}
