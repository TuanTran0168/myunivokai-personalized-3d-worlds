package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The guardrail section 12 says earns its place, and the reason it does is
// worth restating where it lives: THREE OF THE FOUR REASONS CANNOT BE OBSERVED
// IN PRODUCTION TODAY. Production runs AI_PROVIDER=mock (render.yaml), so the
// only reason a running deployment can produce is mock_configured. This test
// is the whole of what stands between the other three and the day AI_PROVIDER
// is flipped to a real provider.
//
// It is also the test that would have caught the defect the owner caught by
// reading: with the two no-AI branches in the wrong order, the second row
// below returns quota_exhausted and the web app announces a limit on an AI
// tier that is switched off.

const generationReasonTestCallTimeout = time.Second
const generationReasonTestTotalBudget = 2 * time.Second
const generationReasonTestRepairAttempts = 1

var errTestProviderIsDown = errors.New("provider is down")

var validDNAPayload = json.RawMessage(`{"valid":true}`)

func acceptEveryPayload(json.RawMessage) (contracts.ProfileDNA, error) {
	return contracts.ProfileDNA{SchemaVersion: contracts.SchemaVersionV1}, nil
}

// Three scripted answers each, which is more than any single branch below
// consumes: a provider that runs out of script panics, and a panic reads as a
// test bug rather than as the behaviour under test.
func answeringProvider(name ProviderName) *scriptedProvider {
	return &scriptedProvider{name: name, responses: []json.RawMessage{validDNAPayload, validDNAPayload, validDNAPayload}}
}

func unreachableProvider(name ProviderName) *scriptedProvider {
	return &scriptedProvider{
		name:      name,
		errors:    []error{errTestProviderIsDown, errTestProviderIsDown, errTestProviderIsDown},
		responses: []json.RawMessage{validDNAPayload, validDNAPayload, validDNAPayload},
	}
}

func TestTheGenerationReasonCoversAllFourRoutesToAWorld(t *testing.T) {
	testCases := []struct {
		description          string
		primaryProvider      *scriptedProvider
		fallbackProvider     *scriptedProvider
		aiTier               AITierEligibility
		expectedReason       contracts.GenerationReason
		expectAFailedJob     bool
		expectedPrimaryCalls int
	}{
		{
			description:          "mock is configured and the caller has allowance left",
			primaryProvider:      answeringProvider(ProviderMock),
			aiTier:               AITierAllowed,
			expectedReason:       contracts.GenerationReasonMockConfigured,
			expectedPrimaryCalls: 1,
		},
		{
			// The row the owner's question produced. mock_configured OUTRANKS
			// quota_exhausted: nothing was withheld, because there was no AI
			// tier to withhold. Reversing the precedence makes this row
			// quota_exhausted and the web app tells every sixth anonymous
			// visitor in production about a limit that cost them nothing.
			description:          "mock is configured AND the caller is over the limit",
			primaryProvider:      answeringProvider(ProviderMock),
			aiTier:               AITierWithheld,
			expectedReason:       contracts.GenerationReasonMockConfigured,
			expectedPrimaryCalls: 1,
		},
		{
			description:          "a real primary is configured and the caller is over the limit",
			primaryProvider:      answeringProvider(ProviderGemini),
			aiTier:               AITierWithheld,
			expectedReason:       contracts.GenerationReasonQuotaExhausted,
			expectedPrimaryCalls: 0,
		},
		{
			description:          "a real primary is configured and answers",
			primaryProvider:      answeringProvider(ProviderGemini),
			aiTier:               AITierAllowed,
			expectedReason:       contracts.GenerationReasonAIGenerated,
			expectedPrimaryCalls: 1,
		},
		{
			description:          "a real primary fails and a distinct fallback produces the world",
			primaryProvider:      unreachableProvider(ProviderGemini),
			fallbackProvider:     answeringProvider(ProviderOpenAI),
			aiTier:               AITierAllowed,
			expectedReason:       contracts.GenerationReasonAIFailedFallback,
			expectedPrimaryCalls: 1,
		},
		{
			// Not a fifth reason, and the distinction is the whole of section
			// 9.1's last paragraph: a reason describes how a world WAS
			// produced. This produces no world, so there is nothing to carry
			// a reason and nothing to tell the visitor about.
			description:          "a real primary fails with no distinct fallback configured",
			primaryProvider:      unreachableProvider(ProviderGemini),
			aiTier:               AITierAllowed,
			expectAFailedJob:     true,
			expectedPrimaryCalls: 1,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.description, func(t *testing.T) {
			presetProvider := answeringProvider(ProviderMock)
			var fallbackProvider Provider
			if testCase.fallbackProvider != nil {
				fallbackProvider = testCase.fallbackProvider
			}
			orchestrator := NewOrchestrator(testCase.primaryProvider, fallbackProvider, presetProvider,
				acceptEveryPayload, generationReasonTestCallTimeout, generationReasonTestTotalBudget, generationReasonTestRepairAttempts)

			result, err := orchestrator.GenerateProfileDNA(context.Background(),
				StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "input"}, testCase.aiTier)

			if testCase.expectAFailedJob {
				if err == nil {
					t.Fatal("expected a failed generation, got a world")
				}
				if result.Reason != "" {
					t.Fatalf("a failed generation carried the reason %q, but it has no world to describe", result.Reason)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected a world, got %v", err)
			}
			if result.Reason != testCase.expectedReason {
				t.Fatalf("expected reason %q, got %q", testCase.expectedReason, result.Reason)
			}
			if testCase.primaryProvider.calls != testCase.expectedPrimaryCalls {
				t.Fatalf("expected the primary provider to be called %d times, got %d",
					testCase.expectedPrimaryCalls, testCase.primaryProvider.calls)
			}
		})
	}
}

// The point of the quota, asserted as money rather than as a reason string: a
// withheld job must not reach the paid provider AT ALL. A reason of
// quota_exhausted on a world the primary was still asked to generate would be
// a ceiling that reports itself while spending.
func TestAWithheldJobNeverReachesThePaidProvider(t *testing.T) {
	paidPrimary := answeringProvider(ProviderGemini)
	distinctFallback := answeringProvider(ProviderOpenAI)
	presetProvider := answeringProvider(ProviderMock)
	orchestrator := NewOrchestrator(paidPrimary, distinctFallback, presetProvider,
		acceptEveryPayload, generationReasonTestCallTimeout, generationReasonTestTotalBudget, generationReasonTestRepairAttempts)

	result, err := orchestrator.GenerateProfileDNA(context.Background(),
		StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "input"}, AITierWithheld)
	if err != nil {
		t.Fatalf("a withheld job must still produce a world: %v", err)
	}
	if result.Reason != contracts.GenerationReasonQuotaExhausted {
		t.Fatalf("expected quota_exhausted, got %q", result.Reason)
	}
	if paidPrimary.calls != 0 {
		t.Fatalf("the paid primary was called %d times for a job the quota withheld", paidPrimary.calls)
	}
	if distinctFallback.calls != 0 {
		t.Fatalf("the fallback was called %d times for a job the quota withheld; it is for a broken primary, not for a spent allowance", distinctFallback.calls)
	}
	if presetProvider.calls != 1 {
		t.Fatalf("expected the preset provider to serve the job once, got %d calls", presetProvider.calls)
	}
}

// The degrade has to be a WORLD, not a shrug. Section 9's whole argument is
// that the visitor loses the AI call and nothing else, so a withheld job must
// come back with DNA that passed the same validator as a paid one.
func TestAWithheldJobStillProducesValidatedDNA(t *testing.T) {
	orchestrator := NewOrchestrator(answeringProvider(ProviderGemini), nil, answeringProvider(ProviderMock),
		acceptEveryPayload, generationReasonTestCallTimeout, generationReasonTestTotalBudget, generationReasonTestRepairAttempts)

	result, err := orchestrator.GenerateProfileDNA(context.Background(),
		StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "input"}, AITierWithheld)
	if err != nil {
		t.Fatalf("expected a world: %v", err)
	}
	if result.ProfileDNA.SchemaVersion != contracts.SchemaVersionV1 {
		t.Fatalf("the withheld job produced no validated DNA: %+v", result.ProfileDNA)
	}
	if len(result.Attempts) != 1 || result.Attempts[0].Status != "success" {
		t.Fatalf("a withheld job must still record its attempt for ai_generation_attempts: %+v", result.Attempts)
	}
	if result.Attempts[0].Provider != string(ProviderMock) {
		t.Fatalf("expected the attempt to record the preset provider, got %q", result.Attempts[0].Provider)
	}
}

// primaryProviderCallsAI is phrased as "not the mock" rather than as a list of
// the paid providers, and this is the reason: a provider added later counts as
// AI on the day it is added. The list form would make it silently free, which
// is the direction that costs money.
func TestAnUnrecognisedProviderCountsAsAI(t *testing.T) {
	const providerAddedAfterThisTestWasWritten = ProviderName("some-new-provider")
	orchestrator := NewOrchestrator(answeringProvider(providerAddedAfterThisTestWasWritten), nil, answeringProvider(ProviderMock),
		acceptEveryPayload, generationReasonTestCallTimeout, generationReasonTestTotalBudget, generationReasonTestRepairAttempts)

	result, err := orchestrator.GenerateProfileDNA(context.Background(),
		StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "input"}, AITierAllowed)
	if err != nil {
		t.Fatalf("expected a world: %v", err)
	}
	if result.Reason != contracts.GenerationReasonAIGenerated {
		t.Fatalf("a provider this build does not recognise produced %q; an unknown provider must be treated as one that spends money", result.Reason)
	}
}

// A quota degrade that leaned on the fallback would stop degrading in exactly
// the configuration production runs: aifactory only builds a fallback when it
// DIFFERS from the primary, so with AI_PROVIDER and AI_FALLBACK_PROVIDER both
// set there is no fallback at all. The preset provider is a third provider for
// this reason, and this test is what fails if somebody removes it as
// redundant.
func TestTheQuotaDegradeDoesNotDependOnAFallbackBeingConfigured(t *testing.T) {
	orchestrator := NewOrchestrator(answeringProvider(ProviderGemini), nil, nil,
		acceptEveryPayload, generationReasonTestCallTimeout, generationReasonTestTotalBudget, generationReasonTestRepairAttempts)

	if _, err := orchestrator.GenerateProfileDNA(context.Background(),
		StructuredRequest{Task: "profile_dna", PromptVersion: "profile-dna-v1", UserPrompt: "input"}, AITierWithheld); err == nil {
		t.Fatal("an orchestrator with no preset provider silently produced a world for a withheld job")
	}
}
