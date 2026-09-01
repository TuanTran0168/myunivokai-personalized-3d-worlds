package services

import (
	"context"
	"errors"
	"fmt"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/validation"
)

const (
	providerUnavailableCode    = "AI_PROVIDER_UNAVAILABLE"
	invalidProviderOutputCode  = "AI_OUTPUT_INVALID"
	providerUnavailableMessage = "The profile could not be generated right now. Please try again."
	invalidProviderOutputText  = "The generated profile did not pass validation. Please try again."
	processingFailedCode       = "DNA_PROCESSING_FAILED"
	processingFailedMessage    = "The profile could not be processed right now. Please try again."
	profileDNASchemaName       = "profile_dna"
	profileDNATemperature      = 0.7
	profileDNAMaximumTokens    = 1600
)

type GenerationService struct {
	config       config.Config
	store        repositories.Store
	orchestrator *ai.Orchestrator
}

func NewGenerationService(serviceConfig config.Config, store repositories.Store, orchestrator *ai.Orchestrator) *GenerationService {
	return &GenerationService{config: serviceConfig, store: store, orchestrator: orchestrator}
}

func (service *GenerationService) Generate(ctx context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	if !envelope.Data.Family.Valid() {
		return fmt.Errorf("invalid world family %q", envelope.Data.Family)
	}
	input := envelope.Data.Input.Normalize()
	if validationDetails := input.Validate(envelope.Data.Family); len(validationDetails) > 0 {
		return fmt.Errorf("invalid world input: %s", validationDetails[0].Message)
	}
	normalizedEnvelope := contracts.Envelope[contracts.GenerateDNAData]{
		JobID: envelope.JobID, Timestamp: envelope.Timestamp,
		Data: contracts.GenerateDNAData{Family: envelope.Data.Family, Input: input},
	}
	jobRecord, err := service.store.EnsureJob(ctx, normalizedEnvelope)
	if err != nil {
		return err
	}
	if jobRecord.Job.Status == contracts.JobStatusCompleted || jobRecord.Job.Status == contracts.JobStatusFailed || jobRecord.Job.DNAVersionID != "" {
		return nil
	}
	if err := service.store.MarkJobProcessing(ctx, envelope.JobID); err != nil {
		return err
	}
	request := ai.StructuredRequest{
		Task:          prompts.ProfileDNATask,
		PromptVersion: service.config.AIPromptVersion,
		SystemPrompt:  prompts.SystemPrompt,
		UserPrompt:    prompts.UserPrompt(input),
		RepairPrompt:  prompts.RepairPrompt,
		SchemaName:    profileDNASchemaName,
		Schema:        validation.ProfileDNASchema(),
		Temperature:   profileDNATemperature,
		MaximumTokens: profileDNAMaximumTokens,
	}
	result, generationError := service.orchestrator.GenerateProfileDNA(ctx, request)
	if generationError != nil {
		failureCode := invalidProviderOutputCode
		failureMessage := invalidProviderOutputText
		if errors.Is(generationError, ai.ErrProviderUnavailable) {
			failureCode = providerUnavailableCode
			failureMessage = providerUnavailableMessage
		}
		if err := service.store.FailDNAJob(ctx, envelope.JobID, envelope.Data.Family, failureCode, failureMessage, result.Attempts); err != nil {
			return fmt.Errorf("record failed dna job: %w", err)
		}
		return nil
	}
	_, err = service.store.StoreDNAAndQueueComposition(ctx, envelope.JobID, input, result.ProfileDNA, result.Attempts)
	return err
}

// FailGeneration creates the root job if necessary and moves a repeatedly
// failing command to a durable terminal state with an outbox event.
func (service *GenerationService) FailGeneration(ctx context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	if !envelope.Data.Family.Valid() {
		return fmt.Errorf("invalid world family %q", envelope.Data.Family)
	}
	normalizedInput := envelope.Data.Input.Normalize()
	if validationDetails := normalizedInput.Validate(envelope.Data.Family); len(validationDetails) > 0 {
		return fmt.Errorf("invalid world input: %s", validationDetails[0].Message)
	}
	normalizedEnvelope := contracts.Envelope[contracts.GenerateDNAData]{
		JobID: envelope.JobID, Timestamp: envelope.Timestamp,
		Data: contracts.GenerateDNAData{Family: envelope.Data.Family, Input: normalizedInput},
	}
	jobRecord, err := service.store.EnsureJob(ctx, normalizedEnvelope)
	if err != nil {
		return err
	}
	if jobRecord.Job.Status == contracts.JobStatusCompleted || jobRecord.Job.Status == contracts.JobStatusFailed {
		return nil
	}
	return service.store.FailDNAJob(ctx, envelope.JobID, envelope.Data.Family, processingFailedCode, processingFailedMessage, nil)
}

func (service *GenerationService) CompleteFamily(ctx context.Context, messageID, subject string, envelope contracts.Envelope[contracts.FamilyCompletedData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	return service.store.ApplyFamilyCompleted(ctx, messageID, subject, envelope)
}

func (service *GenerationService) FailFamily(ctx context.Context, messageID, subject string, envelope contracts.Envelope[contracts.FamilyFailedData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	return service.store.ApplyFamilyFailed(ctx, messageID, subject, envelope)
}

func (service *GenerationService) GetJob(ctx context.Context, jobID string) (contracts.Job, error) {
	return service.store.GetJob(ctx, jobID)
}
