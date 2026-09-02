package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/rs/zerolog/log"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/handlers"
	"github.com/nats-io/nats.go"
)

const queryQueueName = "auth-service-v1"

type queryBinding struct {
	subject string
	handler nats.MsgHandler
}

// Runtime is a pure Core NATS request-reply worker: unlike the family
// services, auth-service never accepts a JetStream command and publishes no
// domain event, so there is no PullSubscribe and no outbox loop to run.
type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, authService handlers.AuthService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-auth"),
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
	return &Runtime{
		config:      serviceConfig,
		connection:  connection,
		natsHandler: handlers.NewNATSHandler(authService, connection, serviceConfig.QueryTimeout),
	}, nil
}

// Run's context parameter matches every other service's Runtime.Run
// signature for interchangeability from main.go, even though this runtime
// starts no background goroutine that would need to observe cancellation.
func (runtime *Runtime) Run(_ context.Context) error {
	queryBindings := []queryBinding{
		{subject: contracts.AuthLoginQuerySubject, handler: runtime.natsHandler.HandleLoginQuery},
		{subject: contracts.AuthRefreshQuerySubject, handler: runtime.natsHandler.HandleRefreshQuery},
		{subject: contracts.AuthLogoutQuerySubject, handler: runtime.natsHandler.HandleLogoutQuery},
		{subject: contracts.AuthWebSignupQuerySubject, handler: runtime.natsHandler.HandleWebSignupQuery},
		{subject: contracts.AuthWebLoginQuerySubject, handler: runtime.natsHandler.HandleWebLoginQuery},
		{subject: contracts.AuthWebRefreshQuerySubject, handler: runtime.natsHandler.HandleWebRefreshQuery},
		{subject: contracts.AuthWebLogoutQuerySubject, handler: runtime.natsHandler.HandleWebLogoutQuery},
		{subject: contracts.AuthTokenVersionQuerySubject, handler: runtime.natsHandler.HandleTokenVersionQuery},
		{subject: contracts.AuthAccountDisableQuerySubject, handler: runtime.natsHandler.HandleAccountDisableQuery},
		{subject: contracts.AuthAccountEnableQuerySubject, handler: runtime.natsHandler.HandleAccountEnableQuery},
		{subject: contracts.AuthInviteCreateQuerySubject, handler: runtime.natsHandler.HandleInviteCreateQuery},
		{subject: contracts.AuthInviteAcceptQuerySubject, handler: runtime.natsHandler.HandleInviteAcceptQuery},
		{subject: contracts.AuthAccountPermissionsQuerySubject, handler: runtime.natsHandler.HandleAccountPermissionsQuery},
		{subject: contracts.AuthAccountListQuerySubject, handler: runtime.natsHandler.HandleAccountListQuery},
		{subject: contracts.AuthAccountGetQuerySubject, handler: runtime.natsHandler.HandleAccountGetQuery},
		{subject: contracts.AuthAccountCreateQuerySubject, handler: runtime.natsHandler.HandleAccountCreateQuery},
		{subject: contracts.AuthAccountUpdateQuerySubject, handler: runtime.natsHandler.HandleAccountUpdateQuery},
		{subject: contracts.AuthRoleListQuerySubject, handler: runtime.natsHandler.HandleRoleListQuery},
		{subject: contracts.AuthRoleCreateQuerySubject, handler: runtime.natsHandler.HandleRoleCreateQuery},
		{subject: contracts.AuthRoleUpdateQuerySubject, handler: runtime.natsHandler.HandleRoleUpdateQuery},
		{subject: contracts.AuthRoleDeleteQuerySubject, handler: runtime.natsHandler.HandleRoleDeleteQuery},
		{subject: contracts.AuthRoleAssignQuerySubject, handler: runtime.natsHandler.HandleRoleAssignQuery},
		{subject: contracts.AuthRoleRevokeQuerySubject, handler: runtime.natsHandler.HandleRoleRevokeQuery},
		{subject: contracts.AuthPermissionListQuerySubject, handler: runtime.natsHandler.HandlePermissionListQuery},
		{subject: contracts.AuthAuditListQuerySubject, handler: runtime.natsHandler.HandleAuditListQuery},
	}
	for _, binding := range queryBindings {
		subscription, err := runtime.connection.QueueSubscribe(binding.subject, queryQueueName, runtime.loggedQuery(binding.handler))
		if err != nil {
			runtime.unsubscribeAll()
			return fmt.Errorf("subscribe auth query %s: %w", binding.subject, err)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush auth subscriptions: %w", err)
	}
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

// loggedQuery wraps a Core NATS query responder with one structured line per
// request answered — the request-level signal this repo's HTTP services get
// for free from middleware.Logging, which a bare NATS subscriber has no
// equivalent of. Subject only, never the payload: auth-service's queries
// carry credentials and account data, which is exactly why nothing besides
// the subject and timing belongs in this line.
func (runtime *Runtime) loggedQuery(handler nats.MsgHandler) nats.MsgHandler {
	return func(message *nats.Msg) {
		start := time.Now()
		handler(message)
		log.Info().Str("subject", message.Subject).Dur("duration", time.Since(start)).Msg("auth query answered")
	}
}

// PublishServiceStarted announces this boot, and is the one place this
// service touches JetStream.
//
// The comment on Runtime above still holds: auth-service accepts no JetStream
// command and publishes no domain event. A boot announcement is neither. It
// is a fact about the process rather than about identity, it is published on
// one literal subject the ACL grants explicitly, and nothing consumes it
// except the read model - so the property worth protecting, that auth-service
// participates in no domain flow, is intact.
//
// It is durable rather than Core NATS because analytics-service is usually
// asleep, and a Core publish with no subscriber is simply lost. The JetStream
// context is built here rather than in NewRuntime so a service that never
// announces a start still pays nothing for it.
func (runtime *Runtime) PublishServiceStarted(ctx context.Context, bootDuration time.Duration) error {
	jetStream, err := runtime.connection.JetStream()
	if err != nil {
		return err
	}
	data := contracts.NewServiceStartedData(contracts.ServiceNameAuth, bootDuration)
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
	publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSConnectTimeout)
	defer cancel()
	if _, err := jetStream.PublishMsg(message, nats.Context(publishContext)); err != nil {
		return err
	}
	log.Info().Str("instance_id", data.InstanceID).Str("version", data.Version).Int64("boot_ms", data.BootDurationMS).Msg("service start announced")
	return nil
}
