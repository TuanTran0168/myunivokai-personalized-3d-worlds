package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/handlers"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	dnaGenerateDurableName   = "dna-generate-v1"
	dnaWorldClaimDurableName = "dna-world-claim-v1"
	dnaResultsDurableName    = "dna-family-results-v1"
	dnaGenerateMessageStage  = ":dna-generate"
	requestQueueName         = "dna-service-v1"
)

type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	store         repositories.Store
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, generationService *services.GenerationService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-dna"),
		nats.Timeout(serviceConfig.NATSConnectTimeout),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(serviceConfig.NATSReconnectWait),
	}
	if serviceConfig.NATSCredentialsFile != "" {
		connectionOptions = append(connectionOptions, nats.UserCredentials(serviceConfig.NATSCredentialsFile))
	} else if serviceConfig.NATSUsername != "" {
		connectionOptions = append(connectionOptions, nats.UserInfo(serviceConfig.NATSUsername, serviceConfig.NATSPassword))
	}
	connection, err := nats.Connect(serviceConfig.NATSURL, connectionOptions...)
	if err != nil {
		return nil, err
	}
	jetStream, err := connection.JetStream()
	if err != nil {
		connection.Close()
		return nil, err
	}
	return &Runtime{
		config: serviceConfig, connection: connection, jetStream: jetStream, store: store,
		natsHandler: handlers.NewNATSHandler(generationService, connection, serviceConfig.QueryTimeout),
	}, nil
}

func (runtime *Runtime) Run(ctx context.Context) error {
	generateSubscription, err := runtime.jetStream.PullSubscribe(
		contracts.GenerateDNACommandSubject,
		dnaGenerateDurableName,
		nats.BindStream(contracts.CommandsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(runtime.config.ConsumerMaximumDeliveries),
		nats.MaxAckPending(1000),
	)
	if err != nil {
		return fmt.Errorf("subscribe dna commands: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, generateSubscription)
	// Its own durable rather than a second filter on the generate consumer.
	// MYUNIVOKAI_COMMANDS is a WorkQueue stream, so one subject may be served
	// by exactly one consumer, and a claim retrying behind a slow AI call
	// would be a claim waiting on something it has nothing to do with.
	claimSubscription, err := runtime.jetStream.PullSubscribe(
		contracts.ClaimDNAWorldsCommandSubject,
		dnaWorldClaimDurableName,
		nats.BindStream(contracts.CommandsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		// Unlimited deliveries, unlike the generate consumer's bounded count.
		// A claim has no visitor waiting and no failed state to record, so
		// there is nowhere for a terminal failure to be reported to - and a
		// claim that gave up would leave a person's worlds anonymous for ever
		// with nothing anywhere saying so. It is idempotent, so retrying until
		// the database answers is safe.
		nats.MaxDeliver(-1),
		nats.MaxAckPending(1000),
	)
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe dna world claims: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, claimSubscription)
	resultsSubscription, err := runtime.jetStream.PullSubscribe(
		"",
		dnaResultsDurableName,
		nats.BindStream(contracts.EventsStream),
		nats.ConsumerFilterSubjects(
			contracts.UniverseCompletedEventSubject,
			contracts.UniverseFailedEventSubject,
			contracts.NatureCompletedEventSubject,
			contracts.NatureFailedEventSubject,
			contracts.OceanCompletedEventSubject,
			contracts.OceanFailedEventSubject,
		),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(-1),
		nats.MaxAckPending(1000),
	)
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe family events: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, resultsSubscription)
	jobQuerySubscription, err := runtime.connection.QueueSubscribe(contracts.DNAJobGetQuerySubject, requestQueueName, runtime.loggedQuery(runtime.natsHandler.HandleJobQuery))
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe job query: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, jobQuerySubscription)
	// The account's own world list. Needs no ACL change: the config grants
	// this service and the gateway `myunivokai.queries.>`, so a new query
	// subject is admitted by the rule that already exists.
	libraryQuerySubscription, err := runtime.connection.QueueSubscribe(contracts.DNALibraryListQuerySubject, requestQueueName, runtime.loggedQuery(runtime.natsHandler.HandleLibraryListQuery))
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe world list query: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, libraryQuerySubscription)
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush DNA subscriptions: %w", err)
	}
	runtime.waitGroup.Add(4)
	go runtime.consume(ctx, generateSubscription, runtime.natsHandler.HandleGenerate, runtime.handleTerminalGenerationFailure)
	go runtime.consume(ctx, claimSubscription, runtime.natsHandler.HandleWorldClaim, nil)
	go runtime.consume(ctx, resultsSubscription, runtime.natsHandler.HandleFamilyResult, nil)
	go runtime.publishOutbox(ctx)
	return nil
}

func (runtime *Runtime) Close() {
	runtime.unsubscribeAll()
	runtime.waitGroup.Wait()
	_ = runtime.connection.Drain()
	runtime.connection.Close()
}

func (runtime *Runtime) unsubscribeAll() {
	for _, subscription := range runtime.subscriptions {
		_ = subscription.Unsubscribe()
	}
	runtime.subscriptions = nil
}

func (runtime *Runtime) consume(
	ctx context.Context,
	subscription *nats.Subscription,
	handler func(context.Context, *nats.Msg) error,
	terminalHandler func(context.Context, *nats.Msg),
) {
	defer runtime.waitGroup.Done()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		messages, err := subscription.Fetch(runtime.config.ConsumerFetchBatchSize, nats.MaxWait(runtime.config.ConsumerFetchMaximumWait))
		if err != nil {
			if errors.Is(err, nats.ErrTimeout) || errors.Is(err, context.DeadlineExceeded) {
				continue
			}
			log.Error().Err(err).Msg("fetch NATS message")
			continue
		}
		for _, message := range messages {
			messageStartTime := time.Now()
			if err := handler(ctx, message); err != nil {
				// A message that can never succeed is discarded rather than
				// retried, and it is told apart by the error rather than by a
				// delivery count. The claim consumer has no delivery limit at
				// all, so without this an unreadable claim would be redelivered
				// for as long as the stream keeps it.
				if errors.Is(err, handlers.ErrInvalidWorldClaimCommand) {
					log.Error().Err(err).Str("subject", message.Subject).Msg("discard invalid world claim command")
					_ = message.Term()
					continue
				}
				metadata, metadataError := message.Metadata()
				if terminalHandler != nil && metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					log.Error().Err(err).Str("subject", message.Subject).Msg("NATS message reached maximum deliveries")
					terminalHandler(ctx, message)
					continue
				}
				// Subject only, never the payload: a job/world/profile id inside it
				// is not secret, but this line is meant to answer "is anything
				// moving" at a glance, not to become a second place a body's shape
				// has to be kept privacy-safe.
				log.Warn().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Err(err).Msg("dna message processing failed, will retry")
				_ = message.NakWithDelay(runtime.config.ConsumerRetryDelay)
				continue
			}
			log.Info().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Msg("dna message processed")
			_ = message.Ack()
		}
	}
}

func (runtime *Runtime) handleTerminalGenerationFailure(ctx context.Context, message *nats.Msg) {
	for {
		if err := runtime.natsHandler.HandleGenerationFailure(ctx, message); err == nil {
			_ = message.Term()
			return
		} else if errors.Is(err, handlers.ErrInvalidGenerateCommand) {
			log.Error().Err(err).Msg("discard invalid DNA generation command")
			_ = message.Term()
			return
		} else {
			log.Error().Err(err).Msg("record terminal DNA generation failure")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(runtime.config.ConsumerRetryDelay):
		}
	}
}

func (runtime *Runtime) publishOutbox(ctx context.Context) {
	defer runtime.waitGroup.Done()
	ticker := time.NewTicker(runtime.config.OutboxPollInterval)
	defer ticker.Stop()
	for {
		if err := runtime.publishOutboxBatch(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("publish DNA outbox batch")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (runtime *Runtime) publishOutboxBatch(ctx context.Context) error {
	messages, err := runtime.store.PendingOutbox(ctx, runtime.config.OutboxBatchSize)
	if err != nil {
		return err
	}
	for _, outboxMessage := range messages {
		message := nats.NewMsg(outboxMessage.Subject)
		message.Header.Set(nats.MsgIdHdr, outboxMessage.MessageID)
		message.Data = outboxMessage.Payload
		publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSPublishTimeout)
		_, publishError := runtime.jetStream.PublishMsg(message, nats.Context(publishContext))
		cancel()
		if publishError != nil {
			return publishError
		}
		if err := runtime.store.MarkOutboxPublished(ctx, outboxMessage.ID); err != nil {
			return err
		}
	}
	return nil
}

// loggedQuery wraps a Core NATS query responder with one structured line per
// request answered — the request-level signal this repo's HTTP services get
// for free from middleware.Logging, which a bare NATS subscriber has no
// equivalent of. Subject only, same reasoning as consume()'s own logging: it
// identifies which query ran without touching a payload that might carry a
// profile or world's contents.
func (runtime *Runtime) loggedQuery(handler nats.MsgHandler) nats.MsgHandler {
	return func(message *nats.Msg) {
		queryStartTime := time.Now()
		handler(message)
		log.Info().Str("subject", message.Subject).Dur("duration", time.Since(queryStartTime)).Msg("dna query answered")
	}
}

func DNAGenerateMessageID(jobID string) string {
	return jobID + dnaGenerateMessageStage
}

// PublishServiceStarted announces this boot so the read model can show it.
//
// A process cannot report its own death - an OOM kill or SIGKILL runs no
// handler - so it reports the start, and a start nobody scheduled is the
// evidence that a stop happened. That inference holds on any host, which is
// why this is a durable event and not part of the gateway's wake mechanism:
// waking belongs to one hosting tier, restarting belongs to running software.
//
// Published to JetStream rather than Core NATS because analytics-service is
// usually asleep. A Core publish with no subscriber is simply lost, which
// would leave the record empty for exactly the services that restart most.
// The Msg-Id is the instance id, so a JetStream redelivery cannot become a
// second boot.
//
// The caller must not treat a failure here as fatal. Announcing a start is
// not why this process exists, and refusing to run because a telemetry
// publish failed would turn an observability gap into an outage.
func (runtime *Runtime) PublishServiceStarted(ctx context.Context, bootDuration time.Duration) error {
	data := contracts.NewServiceStartedData(contracts.ServiceNameDNA, bootDuration)
	subject, err := contracts.ServiceStartedEventSubject(data.Service)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(contracts.NewEnvelope(data.InstanceID, data))
	if err != nil {
		return err
	}
	message := nats.NewMsg(subject)
	message.Header.Set(nats.MsgIdHdr, data.InstanceID)
	message.Data = payload
	publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSPublishTimeout)
	defer cancel()
	if _, err := runtime.jetStream.PublishMsg(message, nats.Context(publishContext)); err != nil {
		return err
	}
	log.Info().Str("instance_id", data.InstanceID).Str("version", data.Version).Int64("boot_ms", data.BootDurationMS).Msg("service start announced")
	return nil
}
