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
	"github.com/myunivokai/myunivokai/shared/family-platform/go/ownership"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	invalidRequestJobID      = "invalid-request"
	failedEventMessageStage  = ":nature-failed"
	compositionFailedCode    = "NATURE_COMPOSITION_FAILED"
	compositionFailedMessage = "The nature world could not be composed. Please try again."
)

var ErrInvalidCompositionCommand = errors.New("invalid nature composition command")

// ErrInvalidWorldClaimCommand marks a claim that can never be applied, as
// distinct from one that failed this time. The claim consumer has no delivery
// limit - a claim must keep retrying until the database answers - so an
// unreadable message needs a way to be discarded that is not a delivery count.
var ErrInvalidWorldClaimCommand = errors.New("invalid nature world claim command")

type WorldService interface {
	ComposeWorld(context.Context, contracts.Envelope[contracts.ComposeWorldData]) (models.CreateWorldResponse, error)
	GetWorlds(context.Context, []string, *string) (models.WorldListResponse, error)
	GetWorld(context.Context, string, *string) (models.WorldResponse, error)
	RegenerateVariant(context.Context, string, *string) (models.VariantResponse, error)
	SelectVariant(context.Context, string, string, *string) (models.VariantResponse, error)
	PublishWorld(context.Context, string, *string) (models.PublishResponse, error)
	DeleteWorld(context.Context, string, *string) (models.DeleteResponse, error)
	ClaimWorlds(context.Context, contracts.Envelope[contracts.WorldClaimData]) error
	GetPublicWorld(context.Context, string) (models.PublicWorldResponse, error)
}

type ResponsePublisher interface {
	Publish(string, []byte) error
}

type EventPublisher interface {
	PublishMsg(*nats.Msg, ...nats.PubOpt) (*nats.PubAck, error)
}

// NATSHandler owns the Nature service's transport-specific request handling.
type NATSHandler struct {
	worldService      WorldService
	responsePublisher ResponsePublisher
	eventPublisher    EventPublisher
	queryTimeout      time.Duration
}

func NewNATSHandler(worldService WorldService, responsePublisher ResponsePublisher, eventPublisher EventPublisher, queryTimeout time.Duration) *NATSHandler {
	return &NATSHandler{
		worldService:      worldService,
		responsePublisher: responsePublisher,
		eventPublisher:    eventPublisher,
		queryTimeout:      queryTimeout,
	}
}

// HandleWorldClaim applies the claim dna-service fanned out to this family.
//
// No terminal-failure path, unlike HandleComposition's: a composition has a
// visitor watching a job and so has to be recorded as failed somewhere they
// can see it, while a claim has nobody waiting and nowhere to report to. A
// plain error return keeps the message on the stream, which is what should
// happen - the claim is idempotent, and a claim that gave up would leave
// somebody's worlds anonymous for ever with nothing anywhere saying so.
func (handler *NATSHandler) HandleWorldClaim(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.WorldClaimData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWorldClaimCommand, err)
	}
	if err := envelope.Data.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWorldClaimCommand, err)
	}
	return handler.worldService.ClaimWorlds(ctx, envelope)
}

func (handler *NATSHandler) HandleComposition(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.ComposeWorldData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		return fmt.Errorf("decode nature command: %w", err)
	}
	_, err := handler.worldService.ComposeWorld(ctx, envelope)
	return err
}

func (handler *NATSHandler) PublishCompositionFailure(ctx context.Context, message *nats.Msg) error {
	var composeEnvelope contracts.Envelope[contracts.ComposeWorldData]
	if err := decodeEnvelope(message.Data, &composeEnvelope); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidCompositionCommand, err)
	}
	failedEnvelope := contracts.NewEnvelope(composeEnvelope.JobID, contracts.FamilyFailedData{
		Family: contracts.WorldFamilyNature, ProfileID: composeEnvelope.Data.ProfileID, DNAVersionID: composeEnvelope.Data.DNAVersionID,
		Code: compositionFailedCode, Message: compositionFailedMessage,
	})
	payload, err := json.Marshal(failedEnvelope)
	if err != nil {
		return fmt.Errorf("marshal nature failed event: %w", err)
	}
	failedMessage := nats.NewMsg(contracts.NatureFailedEventSubject)
	failedMessage.Header.Set(nats.MsgIdHdr, composeEnvelope.JobID+failedEventMessageStage)
	failedMessage.Data = payload
	if _, err := handler.eventPublisher.PublishMsg(failedMessage, nats.Context(ctx)); err != nil {
		return fmt.Errorf("publish nature failed event: %w", err)
	}
	return nil
}

func (handler *NATSHandler) HandleWorldListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.WorldListQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.WorldListResponse, error) {
		return handler.worldService.GetWorlds(ctx, envelope.Data.WorldIDs, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleWorldGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.WorldQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.WorldResponse, error) {
		return handler.worldService.GetWorld(ctx, envelope.Data.WorldID, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleVariantCreateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.VariantCreateData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.VariantResponse, error) {
		return handler.worldService.RegenerateVariant(ctx, envelope.Data.WorldID, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (handler *NATSHandler) HandleVariantSelectQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.VariantSelectData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.VariantResponse, error) {
		return handler.worldService.SelectVariant(ctx, envelope.Data.WorldID, envelope.Data.VariantID, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleWorldPublishQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.PublishWorldData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.PublishResponse, error) {
		return handler.worldService.PublishWorld(ctx, envelope.Data.WorldID, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleWorldDeleteQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.DeleteWorldData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.DeleteResponse, error) {
		return handler.worldService.DeleteWorld(ctx, envelope.Data.WorldID, envelope.Data.RequestingAccountID)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleShareGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.ShareQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (models.PublicWorldResponse, error) {
		return handler.worldService.GetPublicWorld(ctx, envelope.Data.ShareSlug)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
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
	if errors.Is(err, repositories.ErrNotFound) {
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found."))
		return
	}
	// A world that exists and belongs to somebody else is a 403, never a 404.
	// Hiding it as "not found" would be a lie the share URL contradicts one
	// click later, and it would make an owner's own 404 unreadable.
	if errors.Is(err, ownership.ErrNotWorldOwner) {
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "NOT_WORLD_OWNER", "This world belongs to another account."))
		return
	}
	// Distinct from NOT_WORLD_OWNER on purpose. "This is not yours" and "this
	// is nobody's yet" are different situations with different next steps, and
	// only one of them has an answer the visitor can act on.
	if errors.Is(err, ownership.ErrWorldNotOwned) {
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "WORLD_NOT_CLAIMED", "This world has no owner yet. Claim it to your account, then delete it."))
		return
	}
	if errors.Is(err, repositories.ErrConflict) {
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "WORLD_CONFLICT", "The world was changed by another request. Please retry."))
		return
	}
	if err != nil {
		log.Error().Err(err).Str("request_id", jobID).Msg("nature query failed")
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The request could not be completed."))
		return
	}
	responseEnvelope, marshalError := contracts.SuccessRPCEnvelope(jobID, successStatus, payload)
	if marshalError != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
		return
	}
	handler.respond(message, responseEnvelope)
}

func (handler *NATSHandler) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal nature NATS response")
		return
	}
	if err := handler.responsePublisher.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish nature NATS response")
	}
}
