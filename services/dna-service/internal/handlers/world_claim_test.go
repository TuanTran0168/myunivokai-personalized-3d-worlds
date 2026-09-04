package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/nats-io/nats.go"
)

const (
	claimTestAccountID   = "11111111-1111-1111-1111-111111111111"
	claimTestAnonymousID = "22222222-2222-2222-2222-222222222222"
)

// The transport's whole job: decode, and hand both identifiers on unchanged.
func TestHandleWorldClaimDelegatesBothIdentifiers(t *testing.T) {
	service := &generationServiceSpy{}
	handler := NewNATSHandler(service, responsePublisherStub{}, time.Second)
	payload, err := json.Marshal(contracts.NewEnvelope("claim-1", contracts.WorldClaimData{
		AccountID: claimTestAccountID, AnonymousID: claimTestAnonymousID,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := handler.HandleWorldClaim(context.Background(), &nats.Msg{Data: payload}); err != nil {
		t.Fatal(err)
	}
	if len(service.claimedData) != 1 {
		t.Fatalf("claims delegated = %d, want 1", len(service.claimedData))
	}
	claimed := service.claimedData[0]
	if claimed.AccountID != claimTestAccountID || claimed.AnonymousID != claimTestAnonymousID {
		t.Fatalf("claim delegated as %+v, want the account and anonymous ids unchanged", claimed)
	}
}

// A payload this handler cannot read is an error rather than a silent ack, and
// the consumer's unbounded retry is what makes that safe. The two cases below
// are the ones a real stream produces: a truncated write, and a message whose
// envelope is missing the correlation id every other subject requires.
func TestHandleWorldClaimRefusesAMessageItCannotRead(t *testing.T) {
	messages := []struct {
		description string
		payload     []byte
	}{
		{description: "not JSON at all", payload: []byte("{")},
		{description: "an envelope with no job id", payload: []byte(`{"timestamp":"2026-09-03T00:00:00Z","data":{"accountId":"` + claimTestAccountID + `","anonymousId":"` + claimTestAnonymousID + `"}}`)},
	}
	for _, message := range messages {
		t.Run(message.description, func(t *testing.T) {
			service := &generationServiceSpy{}
			handler := NewNATSHandler(service, responsePublisherStub{}, time.Second)
			if err := handler.HandleWorldClaim(context.Background(), &nats.Msg{Data: message.payload}); err == nil {
				t.Fatal("an unreadable claim was accepted")
			}
			if len(service.claimedData) != 0 {
				t.Fatalf("an unreadable claim reached the service: %+v", service.claimedData[0])
			}
		})
	}
}
