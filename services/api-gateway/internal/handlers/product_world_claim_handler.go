package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/oklog/ulid/v2"
	"github.com/rs/zerolog/log"
)

// WorldClaimPublisher is the one thing this handler needs from the broker.
//
// Its own interface rather than broker.Client, for the reason every narrow
// interface in this package exists: a test double for a claim should not have
// to grow a Request method, a Ping and a Close to be accepted.
type WorldClaimPublisher interface {
	PublishWorldClaim(context.Context, contracts.Envelope[contracts.WorldClaimData]) error
}

// worldClaimAcceptedBody says "accepted", not "claimed", and the distinction is
// not pedantry: when this response is written, nothing has been claimed. The
// command is durably in JetStream and dna-service may be asleep. A field called
// `claimed` would be a promise this endpoint is in no position to make.
type worldClaimAcceptedBody struct {
	Accepted bool `json:"accepted"`
}

// ProductWorldClaimHandler answers POST /api/me/worlds/claim.
//
// It is the only route under /api/me that publishes a command rather than
// asking a question, which is why it is a type of its own rather than another
// method on ProductAuthHandler: that one talks to auth-service over Core NATS
// request-reply and holds no JetStream context at all.
type ProductWorldClaimHandler struct {
	claimPublisher WorldClaimPublisher
	transport      *RPCTransport
	publishTimeout time.Duration
}

func NewProductWorldClaimHandler(serviceConfig config.Config, claimPublisher WorldClaimPublisher, transport *RPCTransport) *ProductWorldClaimHandler {
	return &ProductWorldClaimHandler{
		claimPublisher: claimPublisher,
		transport:      transport,
		publishTimeout: serviceConfig.NATSPublishTimeout,
	}
}

// ClaimWorlds turns the worlds this browser made before signing up into the
// worlds this account owns.
//
// The two identifiers come from two different places and neither is in the
// body. The account is the verified token's subject, so "my worlds" is not a
// claim this endpoint has to check. The anonymous id is a header, because it
// is a credential the browser holds rather than data about the request — and
// it is the ONLY thing that proves the claim: a world id would not do, because
// `/worlds/{worldId}` is the URL a visitor sends to a friend, so claiming by
// id would let the recipient of a shared link take somebody else's world.
// There is deliberately no endpoint that accepts one.
func (handler *ProductWorldClaimHandler) ClaimWorlds(responseWriter http.ResponseWriter, request *http.Request) {
	claims, present := middleware.ProductClaims(request.Context())
	if !present {
		httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid session is required.")
		return
	}
	anonymousIdentifier := strings.TrimSpace(request.Header.Get(anonymousIdentifierHeaderName))
	if anonymousIdentifier == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "ANONYMOUS_ID_REQUIRED",
			"There is nothing to claim: this browser has no anonymous identifier.")
		return
	}
	if !contracts.IsUUID(anonymousIdentifier) {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_ANONYMOUS_ID",
			"The anonymous identifier is not in the expected format.")
		return
	}
	// The account id is checked separately, and not as the visitor's fault.
	//
	// It comes from a token this gateway verified, so a subject that is not an
	// account id means the issuer is wrong, not the caller. It is checked
	// anyway because the alternative is a poison message: the claim consumers
	// have no delivery limit, so a command that can never be applied would be
	// redelivered for as long as the stream keeps it.
	if !contracts.IsUUID(claims.Subject) {
		log.Error().Str("request_id", httpx.RequestID(request.Context())).Msg("a verified product token has a subject that is not an account id")
		httpx.WriteError(responseWriter, request, http.StatusInternalServerError, "INVALID_SESSION_SUBJECT",
			"Your worlds could not be claimed right now. Please try again.")
		return
	}
	claimData := contracts.WorldClaimData{AccountID: claims.Subject, AnonymousID: anonymousIdentifier}
	// dna-service only, and not the three family services, which is §7's
	// "only the family services that visitor actually used are woken". The
	// gateway cannot know which those are - `generation_jobs` does, and it
	// lives in dna-service. Waking all three here would spend two cold starts
	// per signup on services with nothing to do.
	//
	// The family claims then wait in MYUNIVOKAI_COMMANDS until each service
	// next runs, which on this hosting tier is the next time anybody opens a
	// world of that family. The stream's retention is what bounds that.
	handler.transport.Wake(wake.ServiceDNA)
	publishContext, cancel := context.WithTimeout(request.Context(), handler.publishTimeout)
	defer cancel()
	// A fresh correlation id per request, and it is what makes the fan-out
	// deduplicate correctly: a JetStream redelivery carries the same one, so
	// dna-service's outbox message ids collide and the family commands are
	// staged once. A genuinely repeated claim gets a new one and is not
	// swallowed - which matters, because a browser that failed to clear its
	// cookie can legitimately claim the same anonymous id again for worlds it
	// made in between.
	claimEnvelope := contracts.NewEnvelope(ulid.Make().String(), claimData)
	if err := handler.claimPublisher.PublishWorldClaim(publishContext, claimEnvelope); err != nil {
		log.Error().Err(err).Str("request_id", httpx.RequestID(request.Context())).Msg("publish world claim command")
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "CLAIM_UNAVAILABLE",
			"Your worlds could not be claimed right now. Please try again.")
		return
	}
	// No read-model wake. A claim emits no event at all - see
	// proxyWorldMutation's readModelEventPolicy and plan §7's correction.
	httpx.WriteJSON(responseWriter, http.StatusAccepted, worldClaimAcceptedBody{Accepted: true})
}
