package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var ErrProviderUnavailable = errors.New("ai provider unavailable")

type ResponseValidator func(json.RawMessage) (contracts.ProfileDNA, error)

type Attempt struct {
	Provider      string
	Model         string
	Task          string
	PromptVersion string
	InputHash     string
	Status        string
	Error         string
	Response      json.RawMessage
	Usage         Usage
	Latency       time.Duration
}

type Result struct {
	ProfileDNA contracts.ProfileDNA
	Attempts   []Attempt
	// Reason is how this DNA was produced, and it is set on every SUCCESSFUL
	// result. A failed result carries none, because a reason describes a world
	// that exists.
	Reason contracts.GenerationReason
}

// AITierEligibility says whether one job may spend an AI call.
//
// A named type rather than a bare bool for the reason the gateway's
// readModelEventPolicy is one: the call site reads
// `GenerateProfileDNA(ctx, request, AITierWithheld)`, which cannot be
// misread, while a bare `false` at that position could mean anything.
//
// It is a property of ONE job, not of the service. The same process serves an
// account with allowance left and an anonymous visitor who is over their
// limit, seconds apart.
type AITierEligibility bool

const (
	AITierAllowed  AITierEligibility = true
	AITierWithheld AITierEligibility = false
)

type Orchestrator struct {
	primaryProvider  Provider
	fallbackProvider Provider
	// presetProvider serves a job the AI tier was withheld from. It is the
	// mock provider, it is always present, and it is a THIRD provider rather
	// than a reuse of the fallback: the fallback exists for a primary that
	// broke and is only constructed when it differs from the primary, so
	// today's production configuration has none at all. A quota degrade that
	// depended on it would silently stop degrading and start failing.
	presetProvider Provider
	validator      ResponseValidator
	callTimeout    time.Duration
	totalBudget    time.Duration
	repairAttempts int
}

func NewOrchestrator(primaryProvider, fallbackProvider, presetProvider Provider, validator ResponseValidator, callTimeout, totalBudget time.Duration, repairAttempts int) *Orchestrator {
	return &Orchestrator{
		primaryProvider:  primaryProvider,
		fallbackProvider: fallbackProvider,
		presetProvider:   presetProvider,
		validator:        validator,
		callTimeout:      callTimeout,
		totalBudget:      totalBudget,
		repairAttempts:   repairAttempts,
	}
}

// GenerateProfileDNA produces DNA and says how it produced it.
//
// The four branches below ARE the precedence rule of section 9.1, in order,
// and the order is the decision rather than an implementation detail:
//
//  1. the primary is not an AI provider  -> mock_configured
//  2. the AI tier was withheld           -> quota_exhausted
//  3. the primary answered               -> ai_generated
//  4. the primary failed, a distinct fallback answered -> ai_failed_fallback
//
// **Swapping 1 and 2 is the failure the owner found by reading the design.**
// Production runs AI_PROVIDER=mock, so with the order reversed every sixth
// anonymous create would report a limit on an AI tier that is switched off —
// not a silent downgrade but a loudly announced one that never happened,
// which section 15 forbids from the opposite direction. Nothing was withheld
// from a caller in a deployment that has nothing to withhold.
//
// A primary failure with NO distinct fallback stays a failure and returns an
// error, which is a failed job with no world. That is correct and it is not a
// fifth reason: the visitor has nothing to be told a reason about.
func (orchestrator *Orchestrator) GenerateProfileDNA(ctx context.Context, request StructuredRequest, aiTier AITierEligibility) (Result, error) {
	if orchestrator.primaryProvider == nil {
		return Result{}, errors.New("primary provider is required")
	}
	budgetContext, cancel := context.WithTimeout(ctx, orchestrator.totalBudget)
	defer cancel()
	attempts := make([]Attempt, 0, 2+orchestrator.repairAttempts)
	if !orchestrator.primaryProviderCallsAI() {
		// The configured provider IS a preset provider here, so this calls the
		// primary rather than reaching past it: what the deployment asked for
		// is what runs.
		return orchestrator.generateWithReason(budgetContext, orchestrator.primaryProvider, request, &attempts,
			contracts.GenerationReasonMockConfigured)
	}
	if aiTier == AITierWithheld {
		return orchestrator.generateWithReason(budgetContext, orchestrator.presetProvider, request, &attempts,
			contracts.GenerationReasonQuotaExhausted)
	}
	result, err := orchestrator.tryProvider(budgetContext, orchestrator.primaryProvider, request, &attempts)
	if err == nil {
		result.Reason = contracts.GenerationReasonAIGenerated
		return result, nil
	}
	if orchestrator.fallbackProvider != nil {
		fallbackResult, fallbackError := orchestrator.tryProvider(budgetContext, orchestrator.fallbackProvider, request, &attempts)
		if fallbackError == nil {
			fallbackResult.Reason = contracts.GenerationReasonAIFailedFallback
			return fallbackResult, nil
		}
		err = fallbackError
	}
	return Result{Attempts: attempts}, err
}

// primaryProviderCallsAI reports whether the configured primary spends money.
//
// Phrased as "is not the mock" rather than as a list of the AI providers, so a
// fourth provider added later counts as AI on the day it is added. The list
// form would make a new provider silently free, which is the direction that
// costs money rather than the direction that costs a preset world.
func (orchestrator *Orchestrator) primaryProviderCallsAI() bool {
	return orchestrator.primaryProvider.Name() != ProviderMock
}

// generateWithReason is the two no-AI-call branches, which are identical apart
// from which provider serves them and what the result is called.
func (orchestrator *Orchestrator) generateWithReason(ctx context.Context, provider Provider, request StructuredRequest, attempts *[]Attempt, reason contracts.GenerationReason) (Result, error) {
	if provider == nil {
		return Result{Attempts: *attempts}, errors.New("a provider is required to produce a world without an AI call")
	}
	result, err := orchestrator.tryProvider(ctx, provider, request, attempts)
	if err != nil {
		return Result{Attempts: *attempts}, err
	}
	result.Reason = reason
	return result, nil
}

func (orchestrator *Orchestrator) tryProvider(ctx context.Context, provider Provider, request StructuredRequest, attempts *[]Attempt) (Result, error) {
	result, validationError, transportError := orchestrator.callProvider(ctx, provider, request, attempts)
	if transportError != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, transportError)
	}
	if validationError == nil {
		return result, nil
	}
	for repairAttempt := 0; repairAttempt < orchestrator.repairAttempts; repairAttempt++ {
		repairRequest := request
		repairRequest.UserPrompt = request.UserPrompt + "\n\n" + request.RepairPrompt + "\nValidation error: " + validationError.Error()
		result, validationError, transportError = orchestrator.callProvider(ctx, provider, repairRequest, attempts)
		if transportError != nil {
			return Result{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, transportError)
		}
		if validationError == nil {
			return result, nil
		}
	}
	return Result{}, validationError
}

func (orchestrator *Orchestrator) callProvider(ctx context.Context, provider Provider, request StructuredRequest, attempts *[]Attempt) (Result, error, error) {
	callContext, cancel := context.WithTimeout(ctx, orchestrator.callTimeout)
	defer cancel()
	startedAt := time.Now()
	response, err := provider.GenerateStructured(callContext, request)
	latency := time.Since(startedAt)
	attempt := Attempt{
		Provider: string(provider.Name()), Task: request.Task, PromptVersion: request.PromptVersion,
		InputHash: fmt.Sprintf("%x", sha256.Sum256([]byte(request.UserPrompt))), Latency: latency,
	}
	if err != nil {
		attempt.Status = "failed"
		attempt.Error = err.Error()
		*attempts = append(*attempts, attempt)
		return Result{}, nil, err
	}
	profileDNA, err := orchestrator.validator(response.JSON)
	attempt.Model = response.Model
	attempt.Response = response.JSON
	attempt.Usage = response.Usage
	if err != nil {
		attempt.Status = "failed"
		attempt.Error = err.Error()
		*attempts = append(*attempts, attempt)
		return Result{}, err, nil
	}
	attempt.Status = "success"
	*attempts = append(*attempts, attempt)
	return Result{ProfileDNA: profileDNA, Attempts: *attempts}, nil, nil
}
