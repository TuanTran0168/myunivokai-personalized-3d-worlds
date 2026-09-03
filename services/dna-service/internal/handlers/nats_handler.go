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
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const invalidRequestJobID = "invalid-request"

var ErrInvalidGenerateCommand = errors.New("invalid DNA generation command")

// ErrInvalidWorldClaimCommand marks a claim that can never be applied, as
// distinct from one that failed this time.
//
// The distinction has to exist because the claim's consumer has no delivery
// limit: a claim must keep retrying until the database answers, since giving up
// would leave somebody's worlds anonymous for ever with nothing anywhere saying
// so. That same unlimited retry turns an unreadable message into one the
// consumer chews on for as long as the stream keeps it, so the two failures are
// told apart here rather than by a delivery count.
var ErrInvalidWorldClaimCommand = errors.New("invalid world claim command")

type GenerationService interface {
	Generate(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error
	FailGeneration(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error
	CompleteFamily(context.Context, string, string, contracts.Envelope[contracts.FamilyCompletedData]) error
	FailFamily(context.Context, string, string, contracts.Envelope[contracts.FamilyFailedData]) error
	ClaimWorlds(context.Context, contracts.Envelope[contracts.WorldClaimData]) error
	GetJob(context.Context, string) (contracts.Job, error)
	ListOwnedWorlds(context.Context, contracts.LibraryListQueryData) (contracts.LibraryListResponseData, error)
}

type ResponsePublisher interface {
	Publish(string, []byte) error
}

// NATSHandler is the inbound transport adapter for DNA commands, events, and queries.
// It depends on narrow interfaces so transport behavior can be tested independently.
type NATSHandler struct {
	generationService GenerationService
	responsePublisher ResponsePublisher
	queryTimeout      time.Duration
}

func NewNATSHandler(generationService GenerationService, responsePublisher ResponsePublisher, queryTimeout time.Duration) *NATSHandler {
	return &NATSHandler{
		generationService: generationService,
		responsePublisher: responsePublisher,
		queryTimeout:      queryTimeout,
	}
}

func (handler *NATSHandler) HandleGenerate(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.GenerateDNAData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		return fmt.Errorf("decode DNA command: %w", err)
	}
	return handler.generationService.Generate(ctx, envelope)
}

// HandleWorldClaim decodes the gateway's one claim command.
//
// No terminal handler is wired for this subject, unlike HandleGenerate's, and
// that is the right shape rather than an omission: a generation failure has a
// visitor watching a job and so has to be recorded as failed somewhere they
// can see it, while a claim has nobody waiting. A claim that cannot be applied
// should keep retrying until the database is reachable, which is what a plain
// error return gets from the consumer loop.
func (handler *NATSHandler) HandleWorldClaim(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.WorldClaimData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWorldClaimCommand, err)
	}
	// Validated here, in the transport, and validated again in the service.
	// Not duplication for its own sake: this is the only layer that can say
	// "this message is unreadable and always will be", and the service is the
	// only layer that would be right to say it about a call from anywhere else.
	if err := envelope.Data.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWorldClaimCommand, err)
	}
	return handler.generationService.ClaimWorlds(ctx, envelope)
}

func (handler *NATSHandler) HandleGenerationFailure(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.GenerateDNAData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidGenerateCommand, err)
	}
	if !envelope.Data.Family.Valid() {
		return fmt.Errorf("%w: unsupported family %q", ErrInvalidGenerateCommand, envelope.Data.Family)
	}
	normalizedInput := envelope.Data.Input.Normalize()
	if validationDetails := normalizedInput.Validate(envelope.Data.Family); len(validationDetails) > 0 {
		return fmt.Errorf("%w: %s", ErrInvalidGenerateCommand, validationDetails[0].Message)
	}
	envelope.Data.Input = normalizedInput
	return handler.generationService.FailGeneration(ctx, envelope)
}

func (handler *NATSHandler) HandleFamilyResult(ctx context.Context, message *nats.Msg) error {
	messageID, err := resultMessageID(message)
	if err != nil {
		return err
	}
	expectedFamily, err := familyForResultSubject(message.Subject)
	if err != nil {
		return err
	}

	switch message.Subject {
	case contracts.UniverseCompletedEventSubject, contracts.NatureCompletedEventSubject, contracts.OceanCompletedEventSubject:
		var envelope contracts.Envelope[contracts.FamilyCompletedData]
		if err := decodeEnvelope(message.Data, &envelope); err != nil {
			return fmt.Errorf("decode family completion: %w", err)
		}
		if envelope.Data.Family != expectedFamily || strings.TrimSpace(envelope.Data.WorldID) == "" {
			return errors.New("family completion data does not match its subject")
		}
		return handler.generationService.CompleteFamily(ctx, messageID, message.Subject, envelope)
	case contracts.UniverseFailedEventSubject, contracts.NatureFailedEventSubject, contracts.OceanFailedEventSubject:
		var envelope contracts.Envelope[contracts.FamilyFailedData]
		if err := decodeEnvelope(message.Data, &envelope); err != nil {
			return fmt.Errorf("decode family failure: %w", err)
		}
		if envelope.Data.Family != expectedFamily || strings.TrimSpace(envelope.Data.Code) == "" || strings.TrimSpace(envelope.Data.Message) == "" {
			return errors.New("family failure data does not match its subject")
		}
		return handler.generationService.FailFamily(ctx, messageID, message.Subject, envelope)
	default:
		return fmt.Errorf("unsupported family result subject %q", message.Subject)
	}
}

func familyForResultSubject(subject string) (contracts.WorldFamily, error) {
	switch subject {
	case contracts.UniverseCompletedEventSubject, contracts.UniverseFailedEventSubject:
		return contracts.WorldFamilyUniverse, nil
	case contracts.NatureCompletedEventSubject, contracts.NatureFailedEventSubject:
		return contracts.WorldFamilyNature, nil
	case contracts.OceanCompletedEventSubject, contracts.OceanFailedEventSubject:
		return contracts.WorldFamilyOcean, nil
	default:
		return "", fmt.Errorf("unsupported family result subject %q", subject)
	}
}

func (handler *NATSHandler) HandleJobQuery(message *nats.Msg) {
	if strings.TrimSpace(message.Reply) == "" {
		return
	}

	var envelope contracts.Envelope[contracts.JobQueryData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(invalidRequestJobID, http.StatusBadRequest, "INVALID_REQUEST", "The job query is invalid."))
		return
	}

	queryContext, cancel := context.WithTimeout(context.Background(), handler.queryTimeout)
	defer cancel()
	job, err := handler.generationService.GetJob(queryContext, envelope.Data.JobID)
	if errors.Is(err, repositories.ErrNotFound) {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusNotFound, "JOB_NOT_FOUND", "The requested job was not found."))
		return
	}
	if err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusServiceUnavailable, "JOB_QUERY_UNAVAILABLE", "The job could not be loaded."))
		return
	}
	responseEnvelope, err := contracts.SuccessRPCEnvelope(envelope.JobID, http.StatusOK, job)
	if err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
		return
	}
	handler.respond(message, responseEnvelope)
}

// HandleLibraryListQuery answers one page of the account's own world list.
//
// A Core query rather than a JetStream command, because somebody is looking at
// a gallery waiting for it - the same shape HandleJobQuery has, and the same
// reason the claim is a command instead.
//
// The owner comes off the query the gateway published and from nowhere else.
// There is no parameter for whose worlds to list other than that one, so this
// handler has no shape in which it could be asked for a stranger's.
func (handler *NATSHandler) HandleLibraryListQuery(message *nats.Msg) {
	if strings.TrimSpace(message.Reply) == "" {
		return
	}
	var envelope contracts.Envelope[contracts.LibraryListQueryData]
	if err := decodeEnvelope(message.Data, &envelope); err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(invalidRequestJobID, http.StatusBadRequest, "INVALID_REQUEST", "The world list query is invalid."))
		return
	}
	// Validated here as well as in the service, for HandleWorldClaim's reason:
	// this is the only layer that can say the MESSAGE is unreadable, and an
	// unreadable cursor has to become a 400 rather than a page of somebody
	// else's worlds or an empty first page.
	if err := envelope.Data.Validate(); err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusBadRequest, "INVALID_REQUEST", "The world list query is invalid."))
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), handler.queryTimeout)
	defer cancel()
	page, err := handler.generationService.ListOwnedWorlds(queryContext, envelope.Data)
	if err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusServiceUnavailable, "WORLD_LIST_UNAVAILABLE", "Your worlds could not be loaded."))
		return
	}
	responseEnvelope, err := contracts.SuccessRPCEnvelope(envelope.JobID, http.StatusOK, page)
	if err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
		return
	}
	handler.respond(message, responseEnvelope)
}

func decodeEnvelope[DataType any](payload []byte, envelope *contracts.Envelope[DataType]) error {
	if err := json.Unmarshal(payload, envelope); err != nil {
		return err
	}
	return envelope.Validate()
}

func resultMessageID(message *nats.Msg) (string, error) {
	if messageID := message.Header.Get(nats.MsgIdHdr); messageID != "" {
		return messageID, nil
	}
	metadata, err := message.Metadata()
	if err != nil {
		return "", fmt.Errorf("read family result metadata: %w", err)
	}
	return fmt.Sprintf("%s:%d", message.Subject, metadata.Sequence.Stream), nil
}

func (handler *NATSHandler) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal DNA NATS query response")
		return
	}
	if err := handler.responsePublisher.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish DNA NATS query response")
	}
}
