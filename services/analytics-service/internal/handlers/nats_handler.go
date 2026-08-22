package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const invalidRequestJobID = "invalid-request"

// AnalyticsService is the read surface this handler exposes over NATS. Note
// what is absent: nothing here writes, and nothing here publishes an event.
type AnalyticsService interface {
	Overview(ctx context.Context, query contracts.AnalyticsOverviewQueryData) (contracts.AnalyticsOverviewResponseData, error)
	Timeseries(ctx context.Context, query contracts.AnalyticsTimeseriesQueryData) (contracts.AnalyticsTimeseriesResponseData, error)
	ListWorlds(ctx context.Context, query contracts.AnalyticsWorldListQueryData) (contracts.AnalyticsWorldListResponseData, error)
	GetWorld(ctx context.Context, query contracts.AnalyticsWorldGetQueryData) (contracts.AnalyticsWorldGetResponseData, error)
	ListJobs(ctx context.Context, query contracts.AnalyticsJobListQueryData) (contracts.AnalyticsJobListResponseData, error)
	ListServiceStarts(ctx context.Context, query contracts.ServiceStartListQueryData) (contracts.ServiceStartListResponseData, error)
}

type ProjectionService interface {
	Apply(ctx context.Context, subject, messageID string, payload []byte) (bool, error)
}

type ResponsePublisher interface {
	Publish(subject string, payload []byte) error
}

type NATSHandler struct {
	analyticsService  AnalyticsService
	projectionService ProjectionService
	responsePublisher ResponsePublisher
	queryTimeout      time.Duration
}

func NewNATSHandler(
	analyticsService AnalyticsService,
	projectionService ProjectionService,
	responsePublisher ResponsePublisher,
	queryTimeout time.Duration,
) *NATSHandler {
	return &NATSHandler{
		analyticsService:  analyticsService,
		projectionService: projectionService,
		responsePublisher: responsePublisher,
		queryTimeout:      queryTimeout,
	}
}

// HandleEvent projects one JetStream delivery. Returning nil means "ack" —
// including for an event this service does not understand, which must be
// acked rather than redelivered forever: the durable filter is a wildcard, so
// a subject introduced by some future service will land here.
func (handler *NATSHandler) HandleEvent(ctx context.Context, message *nats.Msg) error {
	messageID := messageIdentity(message)
	if messageID == "" {
		log.Warn().Str("subject", message.Subject).Msg("event carries no identity; skipping to avoid projecting it repeatedly")
		return nil
	}
	applied, err := handler.projectionService.Apply(ctx, message.Subject, messageID, message.Data)
	switch {
	case errors.Is(err, services.ErrUnknownSubject):
		log.Debug().Str("subject", message.Subject).Msg("ignoring event this projection does not consume")
		return nil
	case err != nil:
		return err
	}
	if !applied {
		log.Debug().Str("subject", message.Subject).Str("messageId", messageID).Msg("duplicate delivery already projected")
	}
	return nil
}

func (handler *NATSHandler) HandleOverviewQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AnalyticsOverviewQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AnalyticsOverviewResponseData, error) {
		return handler.analyticsService.Overview(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

func (handler *NATSHandler) HandleTimeseriesQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AnalyticsTimeseriesQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AnalyticsTimeseriesResponseData, error) {
		return handler.analyticsService.Timeseries(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

func (handler *NATSHandler) HandleWorldListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AnalyticsWorldListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AnalyticsWorldListResponseData, error) {
		return handler.analyticsService.ListWorlds(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

func (handler *NATSHandler) HandleWorldGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AnalyticsWorldGetQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AnalyticsWorldGetResponseData, error) {
		return handler.analyticsService.GetWorld(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

func (handler *NATSHandler) HandleJobListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AnalyticsJobListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.AnalyticsJobListResponseData, error) {
		return handler.analyticsService.ListJobs(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

func (handler *NATSHandler) HandleServiceStartListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.ServiceStartListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.ServiceStartListResponseData, error) {
		return handler.analyticsService.ListServiceStarts(ctx, envelope.Data)
	})
	handler.respondWithResult(message, envelope.JobID, response, err)
}

// messageIdentity prefers the publisher's outbox message id, which is what
// makes idempotency meaningful across a republish. The stream sequence is a
// fallback for any event that predates the Msg-Id convention: it is unique
// per delivery of a given message, so it still prevents a redelivery storm
// from double-projecting within one stream.
func messageIdentity(message *nats.Msg) string {
	if identity := message.Header.Get(nats.MsgIdHdr); identity != "" {
		return identity
	}
	metadata, err := message.Metadata()
	if err != nil {
		return ""
	}
	return message.Subject + ":seq:" + strconv.FormatUint(metadata.Sequence.Stream, 10)
}

func decodeQuery[DataType any](handler *NATSHandler, message *nats.Msg, envelope *contracts.Envelope[DataType]) bool {
	if err := json.Unmarshal(message.Data, envelope); err != nil {
		handler.respondWithError(message, invalidRequestJobID, http.StatusBadRequest, "INVALID_PAYLOAD", "The analytics query payload could not be decoded.")
		return false
	}
	if err := envelope.Validate(); err != nil {
		handler.respondWithError(message, invalidRequestJobID, http.StatusBadRequest, "INVALID_ENVELOPE", err.Error())
		return false
	}
	return true
}

func withQueryTimeout[ResultType any](handler *NATSHandler, run func(context.Context) (ResultType, error)) (ResultType, error) {
	ctx, cancel := context.WithTimeout(context.Background(), handler.queryTimeout)
	defer cancel()
	return run(ctx)
}

func (handler *NATSHandler) respondWithResult(message *nats.Msg, jobID string, payload any, err error) {
	if err != nil {
		statusCode, code, description := describeQueryError(err)
		// A 4xx is the caller's problem, not this service's: an id that was
		// never projected is the expected answer to a stale link. Logging
		// those at error level would fill an hour-long log retention with
		// events nobody can act on and bury the 5xx that matter.
		event := log.Error()
		if statusCode < http.StatusInternalServerError {
			event = log.Debug()
		}
		event.Err(err).Str("subject", message.Subject).Msg("answer analytics query")
		handler.respondWithError(message, jobID, statusCode, code, description)
		return
	}
	envelope, marshalError := contracts.SuccessRPCEnvelope(jobID, http.StatusOK, payload)
	if marshalError != nil {
		log.Error().Err(marshalError).Msg("marshal analytics response")
		handler.respondWithError(message, jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The analytics response could not be encoded.")
		return
	}
	handler.publish(message, envelope)
}

func describeQueryError(err error) (int, string, string) {
	switch {
	case errors.Is(err, repositories.ErrNotFound):
		return http.StatusNotFound, "NOT_FOUND", "No world with that id has been projected."
	case errors.Is(err, repositories.ErrMalformedCursor):
		return http.StatusBadRequest, "INVALID_CURSOR", "The pagination cursor is not valid. Start from the first page."
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "QUERY_TIMEOUT", "The analytics query took too long. Narrow the range or the page size."
	default:
		return http.StatusInternalServerError, "INTERNAL_ERROR", "The analytics query could not be completed."
	}
}

func (handler *NATSHandler) respondWithError(message *nats.Msg, jobID string, statusCode int, code, description string) {
	handler.publish(message, contracts.ErrorRPCEnvelope(jobID, statusCode, code, description))
}

func (handler *NATSHandler) publish(message *nats.Msg, envelope contracts.Envelope[contracts.RPCResponseData]) {
	if message.Reply == "" {
		return
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		log.Error().Err(err).Msg("marshal analytics rpc envelope")
		return
	}
	if err := handler.responsePublisher.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish analytics rpc response")
	}
}
