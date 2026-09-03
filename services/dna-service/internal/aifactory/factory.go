package aifactory

import (
	"fmt"
	"net/http"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/validation"
)

func NewOrchestrator(serviceConfig config.Config) (*ai.Orchestrator, error) {
	primaryProvider, err := newProvider(serviceConfig.AIProvider, serviceConfig)
	if err != nil {
		return nil, err
	}
	var fallbackProvider ai.Provider
	if serviceConfig.AIEnableFallback && serviceConfig.AIFallbackProvider != "" && serviceConfig.AIFallbackProvider != serviceConfig.AIProvider {
		fallbackProvider, err = newProvider(serviceConfig.AIFallbackProvider, serviceConfig)
		if err != nil {
			return nil, err
		}
	}
	// The preset provider is constructed unconditionally and from no
	// configuration at all, unlike the two above. It is what serves a job the
	// daily quota withheld an AI call from (section 9), and that path must
	// exist in every deployment: a quota whose degrade depends on a provider
	// somebody has to configure is a quota that fails to enforce itself in
	// exactly the environment nobody configured.
	//
	// It is also why there is no AI_PRESET_PROVIDER variable. The value would
	// have exactly one legal setting.
	presetProvider := providers.NewMock()
	return ai.NewOrchestrator(primaryProvider, fallbackProvider, presetProvider, validation.ValidateProfileDNA, serviceConfig.AITimeout, serviceConfig.AITotalBudget, serviceConfig.AIRepairAttempts), nil
}

func newProvider(providerName string, serviceConfig config.Config) (ai.Provider, error) {
	httpClient := &http.Client{Timeout: serviceConfig.AITimeout}
	switch ai.ProviderName(providerName) {
	case ai.ProviderMock:
		return providers.NewMock(), nil
	case ai.ProviderGemini:
		return providers.NewGemini(serviceConfig.GeminiAPIKey, serviceConfig.GeminiModel, httpClient), nil
	case ai.ProviderOpenAI:
		return providers.NewOpenAI(serviceConfig.OpenAIAPIKey, serviceConfig.OpenAIModel, httpClient), nil
	default:
		return nil, fmt.Errorf("unsupported ai provider %q", providerName)
	}
}
