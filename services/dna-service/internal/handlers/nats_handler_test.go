package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/nats-io/nats.go"
)

type generationServiceSpy struct {
	generateCalls int
	failureCalls  int
	claimedData   []contracts.WorldClaimData
}

func (service *generationServiceSpy) Generate(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error {
	service.generateCalls++
	return nil
}

func (service *generationServiceSpy) FailGeneration(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error {
	service.failureCalls++
	return nil
}

func TestHandleGenerationFailureDelegatesValidCommand(t *testing.T) {
	service := &generationServiceSpy{}
	handler := NewNATSHandler(service, responsePublisherStub{}, time.Second)
	envelope := contracts.NewEnvelope("job-1", contracts.GenerateDNAData{
		Family: contracts.WorldFamilyUniverse,
		Input: contracts.WorldInput{
			Nickname: "Nova", Interests: []string{"AI", "Music", "Space"}, Traits: []string{"Curious", "Calm", "Focused"},
			Goal: "Build a meaningful creative universe", Mood: "curious", FavoriteColors: []string{"#8B5CF6"}, PreferredWorldStyle: "nebula",
		},
	})
	payload, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := handler.HandleGenerationFailure(context.Background(), &nats.Msg{Data: payload}); err != nil {
		t.Fatal(err)
	}
	if service.failureCalls != 1 {
		t.Fatalf("failure calls = %d, want 1", service.failureCalls)
	}
}

func (*generationServiceSpy) CompleteFamily(context.Context, string, string, contracts.Envelope[contracts.FamilyCompletedData]) error {
	return nil
}

func (*generationServiceSpy) FailFamily(context.Context, string, string, contracts.Envelope[contracts.FamilyFailedData]) error {
	return nil
}

func (service *generationServiceSpy) ClaimWorlds(_ context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) error {
	service.claimedData = append(service.claimedData, envelope.Data)
	return nil
}

func (*generationServiceSpy) GetJob(context.Context, string) (contracts.Job, error) {
	return contracts.Job{}, nil
}

type responsePublisherStub struct{}

func (responsePublisherStub) Publish(string, []byte) error { return nil }

func TestHandleGenerateValidatesEnvelopeBeforeCallingService(t *testing.T) {
	service := &generationServiceSpy{}
	handler := NewNATSHandler(service, responsePublisherStub{}, time.Second)
	message := nats.NewMsg(contracts.GenerateDNACommandSubject)
	message.Data = []byte(`{"jobId":"job-1","data":{}}`)

	if err := handler.HandleGenerate(context.Background(), message); err == nil {
		t.Fatal("expected missing timestamp to be rejected")
	}
	if service.generateCalls != 0 {
		t.Fatalf("generate calls = %d, want 0", service.generateCalls)
	}
}
