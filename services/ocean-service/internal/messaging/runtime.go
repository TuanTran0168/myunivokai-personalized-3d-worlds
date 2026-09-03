package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/config"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/handlers"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	composeDurableName = "ocean-compose-v1"
	queryQueueName     = "ocean-service-v1"
)

type queryBinding struct {
	subject string
	handler nats.MsgHandler
}

type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	store         repositories.Store
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, worldService *services.WorldService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-ocean"),
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
		natsHandler: handlers.NewNATSHandler(worldService, connection, jetStream, serviceConfig.QueryTimeout),
	}, nil
}

func (runtime *Runtime) Run(ctx context.Context) error {
	composeSubscription, err := runtime.jetStream.PullSubscribe(
		contracts.ComposeOceanCommandSubject,
		composeDurableName,
		nats.BindStream(contracts.CommandsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(runtime.config.ConsumerMaximumDeliveries),
		nats.MaxAckPending(1000),
	)
	if err != nil {
		return fmt.Errorf("subscribe ocean commands: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, composeSubscription)
	queryBindings := []queryBinding{
		{subject: contracts.OceanWorldListQuerySubject, handler: runtime.natsHandler.HandleWorldListQuery},
		{subject: contracts.OceanWorldGetQuerySubject, handler: runtime.natsHandler.HandleWorldGetQuery},
		{subject: contracts.OceanVariantCreateSubject, handler: runtime.natsHandler.HandleVariantCreateQuery},
		{subject: contracts.OceanVariantSelectSubject, handler: runtime.natsHandler.HandleVariantSelectQuery},
		{subject: contracts.OceanWorldPublishSubject, handler: runtime.natsHandler.HandleWorldPublishQuery},
		{subject: contracts.OceanWorldDeleteSubject, handler: runtime.natsHandler.HandleWorldDeleteQuery},
		{subject: contracts.OceanShareGetQuerySubject, handler: runtime.natsHandler.HandleShareGetQuery},
	}
	for _, binding := range queryBindings {
		subscription, subscribeError := runtime.connection.QueueSubscribe(binding.subject, queryQueueName, runtime.loggedQuery(binding.handler))
		if subscribeError != nil {
			runtime.unsubscribeAll()
			return fmt.Errorf("subscribe ocean query %s: %w", binding.subject, subscribeError)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush ocean subscriptions: %w", err)
	}
	runtime.waitGroup.Add(2)
	go runtime.consumeCompositions(ctx, composeSubscription)
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

func (runtime *Runtime) consumeCompositions(ctx context.Context, subscription *nats.Subscription) {
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
			log.Error().Err(err).Msg("fetch ocean composition")
			continue
		}
		for _, message := range messages {
			messageStartTime := time.Now()
			if err := runtime.natsHandler.HandleComposition(ctx, message); err != nil {
				metadata, metadataError := message.Metadata()
				if metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					runtime.publishTerminalCompositionFailure(ctx, message)
					continue
				}
				// Subject only, never the payload: a job/world/profile id inside it
				// is not secret, but this line is meant to answer "is anything
				// moving" at a glance, not to become a second place a body's shape
				// has to be kept privacy-safe.
				log.Warn().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Err(err).Msg("ocean message processing failed, will retry")
				_ = message.NakWithDelay(runtime.config.ConsumerRetryDelay)
				continue
			}
			log.Info().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Msg("ocean message processed")
			_ = message.Ack()
		}
	}
}

func (runtime *Runtime) publishTerminalCompositionFailure(ctx context.Context, message *nats.Msg) {
	for {
		publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSPublishTimeout)
		err := runtime.natsHandler.PublishCompositionFailure(publishContext, message)
		cancel()
		if err == nil {
			_ = message.Term()
			return
		} else if errors.Is(err, handlers.ErrInvalidCompositionCommand) {
			log.Error().Err(err).Msg("discard invalid ocean composition command")
			_ = message.Term()
			return
		} else {
			log.Error().Err(err).Msg("publish terminal ocean failure")
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
			log.Error().Err(err).Msg("publish ocean outbox batch")
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
// equivalent of. Subject only, same reasoning as consumeCompositions()'s own
// logging: it identifies which query ran without touching a payload that
// might carry a world's contents.
func (runtime *Runtime) loggedQuery(handler nats.MsgHandler) nats.MsgHandler {
	return func(message *nats.Msg) {
		queryStartTime := time.Now()
		handler(message)
		log.Info().Str("subject", message.Subject).Dur("duration", time.Since(queryStartTime)).Msg("ocean query answered")
	}
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
	data := contracts.NewServiceStartedData(contracts.ServiceNameOcean, bootDuration)
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
