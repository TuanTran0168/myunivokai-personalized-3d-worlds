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
	"github.com/rs/zerolog/log"
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
	// A copy with ONE field replaced, never a rebuilt literal.
	//
	// It was a rebuilt literal, and that silently dropped OwnerAccountID: the
	// gateway stamped the owner onto the generate command, this line dropped
	// it, and EnsureJob wrote NULL — so every world created by a signed-in
	// visitor was stored as anonymous while every test still passed. A literal
	// that has to name each field is a literal that forgets the next one too;
	// this form cannot.
	normalizedEnvelope := envelope
	normalizedEnvelope.Data.Input = input
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
	result, generationError := service.orchestrator.GenerateProfileDNA(ctx, request, aiTierFor(envelope.Data.AIQuota))
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
	_, err = service.store.StoreDNAAndQueueComposition(ctx, envelope.JobID, input, result.ProfileDNA, result.Attempts,
		repositories.GenerationOutcome{
			Reason:                 result.Reason,
			DailyAIGenerationLimit: dailyAIGenerationLimitFor(envelope.Data.AIQuota),
		})
	return err
}

// aiTierFor turns the gateway's verdict into this one job's eligibility.
//
// A command with NO verdict is ALLOWED, and that is the safe direction here
// rather than the generous one. The only commands without a verdict are those
// published before the quota shipped and still inside MYUNIVOKAI_COMMANDS'
// seven-day retention: a bounded, already-created set. Refusing them would
// degrade worlds nobody was over any limit for, and would do it days after the
// fact, for a saving of at most a few generations.
//
// The counter is unaffected either way. It lives in the gateway, it already
// counted every one of those creates, and nothing in this service can spend or
// refund one.
func aiTierFor(quotaState *contracts.AIQuotaState) ai.AITierEligibility {
	if quotaState == nil {
		return ai.AITierAllowed
	}
	if quotaState.Exhausted {
		return ai.AITierWithheld
	}
	return ai.AITierAllowed
}

// dailyAIGenerationLimitFor is the limit the verdict was measured against,
// stored beside the reason so the web app's one sentence names the number the
// platform enforced rather than a copy of it in TypeScript.
//
// nil for a command with no verdict, which is the NULL the column means. A
// verdict whose limit is zero returns a pointer to zero, because that is an
// operator turning the AI tier off for one audience and not an absence of
// information.
func dailyAIGenerationLimitFor(quotaState *contracts.AIQuotaState) *int {
	if quotaState == nil {
		return nil
	}
	enforcedDailyLimit := quotaState.DailyLimit
	return &enforcedDailyLimit
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
	// A copy with one field replaced, for the reason Generate's own comment
	// gives at length. This literal was the SECOND instance of the same
	// defect, found while adding the quota field to this command and left
	// unrecorded by Phase B correction 8, which fixed only the one on the
	// success path.
	//
	// It is the cheaper half of that bug and it is still a real one: a
	// generate command that exhausts its deliveries reaches this method, and
	// EnsureJob then writes a profile with a NULL owner and a NULL anonymous
	// id. There is no world to lose, so nothing became unclaimable — but the
	// raw input the visitor typed is stored on a row that no longer says whose
	// it is, which is the one thing a personal-data row must never forget.
	normalizedEnvelope := envelope
	normalizedEnvelope.Data.Input = normalizedInput
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

// ClaimWorlds is the fan-in half of the claim: one command from the gateway,
// one transaction here, and one command out to each family the visitor used.
//
// The data is validated even though the gateway already validated it, and the
// reason is not distrust of the gateway - the ACLs make it the only publisher
// that can reach this subject. It is that both values reach a `WHERE` clause,
// and a malformed one would fail the transaction halfway through a fan-out
// rather than being refused whole.
func (service *GenerationService) ClaimWorlds(ctx context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	if err := envelope.Data.Validate(); err != nil {
		return err
	}
	claimResult, err := service.store.ClaimWorlds(ctx, envelope)
	if err != nil {
		return err
	}
	// The only observability a claim has. Nobody is waiting for the answer, so
	// a claim that matched nothing and a claim that moved five worlds are
	// otherwise the same silent success. Neither identifier is logged: the
	// account id and the anonymous id are exactly the two values that would
	// turn this line into a way of tying a person to their worlds.
	log.Info().
		Int64("claimed_profiles", claimResult.ClaimedProfileCount).
		Int("notified_families", len(claimResult.NotifiedFamilies)).
		Msg("anonymous worlds claimed")
	return nil
}

func (service *GenerationService) GetJob(ctx context.Context, jobID string) (contracts.Job, error) {
	return service.store.GetJob(ctx, jobID)
}
