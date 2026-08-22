package messaging

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/config"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/handlers"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	// eventsDurableName is this service's own durable consumer on
	// MYUNIVOKAI_EVENTS. It is a second consumer on a stream that already
	// declares max_consumers: -1, and dna-service's consumer uses explicit
	// ConsumerFilterSubjects, so neither one can see or affect the other.
	eventsDurableName = "analytics-events-v1"
	// eventsFilterSubject is a wildcard because this service is the read
	// model for everything: a new event subject should reach it without a
	// code change, and its NATS user grants exactly this subscription.
	eventsFilterSubject = "myunivokai.events.>"
	queryQueueName      = "analytics-service-v1"
	// consumerMaximumAckPending matches every other consumer in the repo.
	consumerMaximumAckPending = 1000
)

type queryBinding struct {
	subject string
	handler nats.MsgHandler
}

// Runtime consumes events and answers queries. It has no outbox loop and no
// publish permission: the only subject it ever writes to is the caller's
// reply inbox.
type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(
	serviceConfig config.Config,
	analyticsService handlers.AnalyticsService,
	projectionService handlers.ProjectionService,
) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-analytics"),
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
		config:      serviceConfig,
		connection:  connection,
		jetStream:   jetStream,
		natsHandler: handlers.NewNATSHandler(analyticsService, projectionService, connection, serviceConfig.QueryTimeout),
	}, nil
}

func (runtime *Runtime) Run(ctx context.Context) error {
	// MaxDeliver(-1) matches dna-service's results consumer: a projection
	// that cannot be written is a transient database problem, and dropping
	// the event would leave the read model permanently wrong with nothing to
	// replay from once the 7-day retention window passes.
	eventsSubscription, err := runtime.jetStream.PullSubscribe(
		eventsFilterSubject,
		eventsDurableName,
		nats.BindStream(contracts.EventsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(-1),
		nats.MaxAckPending(consumerMaximumAckPending),
	)
	if err != nil {
		return fmt.Errorf("subscribe analytics events: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, eventsSubscription)

	queryBindings := []queryBinding{
		{subject: contracts.AnalyticsOverviewGetQuerySubject, handler: runtime.natsHandler.HandleOverviewQuery},
		{subject: contracts.AnalyticsWorldListQuerySubject, handler: runtime.natsHandler.HandleWorldListQuery},
		{subject: contracts.AnalyticsWorldGetQuerySubject, handler: runtime.natsHandler.HandleWorldGetQuery},
		{subject: contracts.AnalyticsJobListQuerySubject, handler: runtime.natsHandler.HandleJobListQuery},
		{subject: contracts.AnalyticsTimeseriesGetQuerySubject, handler: runtime.natsHandler.HandleTimeseriesQuery},
		{subject: contracts.AnalyticsServiceStartListQuerySubject, handler: runtime.natsHandler.HandleServiceStartListQuery},
	}
	for _, binding := range queryBindings {
		subscription, subscribeError := runtime.connection.QueueSubscribe(binding.subject, queryQueueName, runtime.loggedQuery(binding.handler))
		if subscribeError != nil {
			runtime.unsubscribeAll()
			return fmt.Errorf("subscribe analytics query %s: %w", binding.subject, subscribeError)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush analytics subscriptions: %w", err)
	}
	runtime.waitGroup.Add(1)
	go runtime.consumeEvents(ctx, eventsSubscription)
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

func (runtime *Runtime) consumeEvents(ctx context.Context, subscription *nats.Subscription) {
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
			log.Error().Err(err).Msg("fetch analytics events")
			continue
		}
		for _, message := range messages {
			messageStartTime := time.Now()
			if err := runtime.natsHandler.HandleEvent(ctx, message); err != nil {
				// Subject only, never the payload: a job/world/profile id inside it
				// is not secret, but this line is meant to answer "is anything
				// moving" at a glance, not to become a second place a body's shape
				// has to be kept privacy-safe.
				log.Warn().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Err(err).Msg("analytics message processing failed, will retry")
				_ = message.NakWithDelay(runtime.config.ConsumerRetryDelay)
				continue
			}
			log.Info().Str("subject", message.Subject).Dur("duration", time.Since(messageStartTime)).Msg("analytics message processed")
			_ = message.Ack()
		}
	}
}

// loggedQuery wraps a Core NATS query responder with one structured line per
// request answered — the request-level signal this repo's HTTP services get
// for free from middleware.Logging, which a bare NATS subscriber has no
// equivalent of. Subject only, never the payload: this service's own event
// stream carries full world snapshots, which is exactly why nothing besides
// the subject and timing belongs in this line either.
func (runtime *Runtime) loggedQuery(handler nats.MsgHandler) nats.MsgHandler {
	return func(message *nats.Msg) {
		queryStartTime := time.Now()
		handler(message)
		log.Info().Str("subject", message.Subject).Dur("duration", time.Since(queryStartTime)).Msg("analytics query answered")
	}
}
