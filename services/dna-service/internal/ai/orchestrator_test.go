package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

type scriptedProvider struct {
	name      ProviderName
	responses []json.RawMessage
	errors    []error
	calls     int
}

func (provider *scriptedProvider) Name() ProviderName { return provider.name }

func (provider *scriptedProvider) GenerateStructured(context.Context, StructuredRequest) (*StructuredResponse, error) {
	callIndex := provider.calls
	provider.calls++
	if callIndex < len(provider.errors) && provider.errors[callIndex] != nil {
		return nil, provider.errors[callIndex]
	}
	return &StructuredResponse{Provider: provider.name, Model: "test-model", JSON: provider.responses[callIndex]}, nil
}

func TestOrchestratorRepairsInvalidOutputAndRecordsTraceMetadata(t *testing.T) {
	provider := &scriptedProvider{name: ProviderMock, responses: []json.RawMessage{json.RawMessage(`{}`), json.RawMessage(`{"valid":true}`)}}
	validator := func(payload json.RawMessage) (contracts.ProfileDNA, error) {
		if string(payload) == `{}` {
			return contracts.ProfileDNA{}, errors.New("invalid")
		}
		return contracts.ProfileDNA{SchemaVersion: contracts.SchemaVersionV1}, nil
	}
	orchestrator := NewOrchestrator(provider, nil, provider, validator, time.Second, 2*time.Second, 1)
	result, err := orchestrator.GenerateProfileDNA(context.Background(), StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "sensitive input", RepairPrompt: "repair"}, AITierAllowed)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attempts) != 2 || result.Attempts[0].Status != "failed" || result.Attempts[1].Status != "success" {
		t.Fatalf("unexpected attempts: %+v", result.Attempts)
	}
	if result.Attempts[0].InputHash == "" || result.Attempts[0].InputHash == "sensitive input" || result.Attempts[0].PromptVersion != "profile-dna-v1" {
		t.Fatalf("attempt trace metadata is unsafe or incomplete: %+v", result.Attempts[0])
	}
}
