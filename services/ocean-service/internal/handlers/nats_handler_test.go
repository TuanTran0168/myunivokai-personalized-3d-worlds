package handlers

import (
	"context"
	"encoding/json"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/nats-io/nats.go"
)

type eventPublisherSpy struct {
	message *nats.Msg
}

func (publisher *eventPublisherSpy) PublishMsg(message *nats.Msg, _ ...nats.PubOpt) (*nats.PubAck, error) {
	publisher.message = message
	return &nats.PubAck{}, nil
}

func TestPublishCompositionFailureUsesOceanContract(t *testing.T) {
	publisher := &eventPublisherSpy{}
	handler := NewNATSHandler(nil, nil, publisher, 0)
	envelope := contracts.NewEnvelope("job-1", contracts.ComposeWorldData{ProfileID: "profile-1", DNAVersionID: "dna-1"})
	payload, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := handler.PublishCompositionFailure(context.Background(), &nats.Msg{Data: payload}); err != nil {
		t.Fatal(err)
	}
	if publisher.message.Subject != contracts.OceanFailedEventSubject {
		t.Fatalf("subject = %q", publisher.message.Subject)
	}
	var failure contracts.Envelope[contracts.FamilyFailedData]
	if err := json.Unmarshal(publisher.message.Data, &failure); err != nil {
		t.Fatal(err)
	}
	if failure.Data.Family != contracts.WorldFamilyOcean || failure.Data.ProfileID != "profile-1" {
		t.Fatalf("unexpected failure data: %+v", failure.Data)
	}
}
