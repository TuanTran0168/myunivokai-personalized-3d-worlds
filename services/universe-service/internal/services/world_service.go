package services

import (
	"context"
	"errors"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/seed"
)

const (
	maximumVariantCreateAttempts = 3
	maximumPublishAttempts       = 3
	interestPlanetType           = "Interest Planet"
	traitPlanetType              = "Trait Planet"
)

type WorldService struct {
	config  config.Config
	store   repositories.Store
	builder *WorldConfigBuilder
}

func NewWorldService(serviceConfig config.Config, store repositories.Store, builder *WorldConfigBuilder) *WorldService {
	return &WorldService{config: serviceConfig, store: store, builder: builder}
}

func (service *WorldService) ComposeWorld(ctx context.Context, envelope contracts.Envelope[contracts.ComposeWorldData]) (models.CreateWorldResponse, error) {
	if err := envelope.Validate(); err != nil {
		return models.CreateWorldResponse{}, err
	}
	if envelope.Data.Family != contracts.WorldFamilyUniverse {
		return models.CreateWorldResponse{}, errors.New("universe service received a non-universe command")
	}
	personalityDNA := personalityDNAFromProfile(envelope.Data.ProfileDNA)
	worldSeed, err := seed.NewWorldSeed()
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	visualIntent := models.VisualIntent{
		Mood:                envelope.Data.VisualIntent.Mood,
		FavoriteColors:      envelope.Data.VisualIntent.FavoriteColors,
		PreferredWorldStyle: envelope.Data.VisualIntent.PreferredWorldStyle,
	}
	sceneConfig := service.builder.Build(BuildWorldConfigInput{DNA: personalityDNA, Seed: worldSeed, VariantNo: 1, Input: visualIntent})
	world := models.World{
		SourceJobID:    envelope.JobID,
		ProfileID:      envelope.Data.ProfileID,
		DNAVersionID:   envelope.Data.DNAVersionID,
		Nickname:       envelope.Data.Profile.Nickname,
		Role:           envelope.Data.Profile.Role,
		VisualIntent:   visualIntent,
		PersonalityDNA: personalityDNA,
		Archetype:      personalityDNA.Archetype,
		SceneName:      personalityDNA.SceneName,
		Quote:          personalityDNA.Quote,
		ShortNarrative: personalityDNA.ShortNarrative,
		Visibility:     "private",
		// Straight from the compose command, which dna-service copied from the
		// generate command, which the gateway stamped from a verified token.
		// Nothing on this path reads it from a request body.
		OwnerAccountID: envelope.Data.OwnerAccountID,
	}
	variant := models.WorldVariant{VariantNo: 1, Seed: worldSeed, Config: sceneConfig, IsSelected: true}
	bundle, err := service.store.CreateWorld(ctx, world, variant)
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	return models.CreateWorldResponse{World: bundle.World, Variant: selectedVariant(bundle.Variants), PersonalityDNA: personalityDNA}, nil
}

func (service *WorldService) GetWorld(ctx context.Context, worldID string) (models.WorldResponse, error) {
	bundle, err := service.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.WorldResponse{}, err
	}
	return worldResponse(bundle), nil
}

func (service *WorldService) GetWorlds(ctx context.Context, worldIDs []string) (models.WorldListResponse, error) {
	bundles, err := service.store.GetWorldsByIDs(ctx, worldIDs)
	if err != nil {
		return models.WorldListResponse{}, err
	}
	worlds := make([]models.WorldResponse, 0, len(bundles))
	for _, bundle := range bundles {
		worlds = append(worlds, worldResponse(bundle))
	}
	return models.WorldListResponse{Worlds: worlds}, nil
}

func (service *WorldService) RegenerateVariant(ctx context.Context, worldID string, requestingAccountID *string) (models.VariantResponse, error) {
	var lastConflictError error
	for attempt := 0; attempt < maximumVariantCreateAttempts; attempt++ {
		bundle, err := service.store.GetWorld(ctx, worldID)
		if err != nil {
			return models.VariantResponse{}, err
		}
		nextVariantNumber := highestVariantNumber(bundle.Variants) + 1
		variantSeed, err := seed.NewVariantSeed(worldID, nextVariantNumber)
		if err != nil {
			return models.VariantResponse{}, err
		}
		sceneConfig := service.builder.Build(BuildWorldConfigInput{DNA: bundle.World.PersonalityDNA, Seed: variantSeed, VariantNo: nextVariantNumber, Input: bundle.World.VisualIntent})
		variant, err := service.store.AddVariant(ctx, worldID, models.WorldVariant{VariantNo: nextVariantNumber, Seed: variantSeed, Config: sceneConfig}, requestingAccountID)
		if err == nil {
			return models.VariantResponse{Variant: variant, ShareSlug: shareSlugValue(bundle.World.ShareSlug)}, nil
		}
		if !errors.Is(err, repositories.ErrConflict) {
			return models.VariantResponse{}, err
		}
		lastConflictError = err
	}
	return models.VariantResponse{}, lastConflictError
}

func (service *WorldService) SelectVariant(ctx context.Context, worldID, variantID string, requestingAccountID *string) (models.VariantResponse, error) {
	// The share slug is read BEFORE the selection, not after: the gateway needs it
	// to drop the stale public share response, and reading first means a failed
	// lookup can never report a selection that already committed as an error.
	// Publishing never rewrites an existing slug, so it cannot change underneath.
	bundle, err := service.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.VariantResponse{}, err
	}
	variant, err := service.store.SelectVariant(ctx, worldID, variantID, requestingAccountID)
	if err != nil {
		return models.VariantResponse{}, err
	}
	return models.VariantResponse{Variant: variant, ShareSlug: shareSlugValue(bundle.World.ShareSlug)}, nil
}

func (service *WorldService) PublishWorld(ctx context.Context, worldID string, requestingAccountID *string) (models.PublishResponse, error) {
	bundle, err := service.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.PublishResponse{}, err
	}
	slugBase := slugify(bundle.World.Nickname)
	if slugBase == "" {
		slugBase = "orbit"
	}
	var lastConflictError error
	for attempt := 0; attempt < maximumPublishAttempts; attempt++ {
		slugSuffix, err := seed.NewShareSlugSuffix(service.config.ShareSlugLength)
		if err != nil {
			return models.PublishResponse{}, err
		}
		world, err := service.store.PublishWorld(ctx, worldID, slugBase+"-"+slugSuffix, requestingAccountID)
		if err == nil {
			if world.ShareSlug == nil {
				return models.PublishResponse{}, errors.New("share slug was not created")
			}
			return models.PublishResponse{ShareSlug: *world.ShareSlug, ShareURL: strings.TrimRight(service.config.PublicWebURL, "/") + "/share/" + *world.ShareSlug}, nil
		}
		if !errors.Is(err, repositories.ErrConflict) {
			return models.PublishResponse{}, err
		}
		lastConflictError = err
	}
	return models.PublishResponse{}, lastConflictError
}

func (service *WorldService) GetPublicWorld(ctx context.Context, shareSlug string) (models.PublicWorldResponse, error) {
	bundle, err := service.store.GetPublicWorld(ctx, shareSlug)
	if err != nil {
		return models.PublicWorldResponse{}, err
	}
	variant := selectedVariant(bundle.Variants)
	return models.PublicWorldResponse{
		World: models.PublicWorld{
			Nickname:       bundle.World.Nickname,
			Archetype:      bundle.World.Archetype,
			SceneName:      bundle.World.SceneName,
			Quote:          bundle.World.Quote,
			ShortNarrative: bundle.World.PersonalityDNA.ShortNarrative,
		},
		Variant:   models.PublicVariant{Seed: variant.Seed, Config: variant.Config},
		PublicDNA: models.PublicDNA{TraitScores: bundle.World.PersonalityDNA.TraitScores, Planets: bundle.World.PersonalityDNA.Planets},
	}, nil
}

func personalityDNAFromProfile(profileDNA contracts.ProfileDNA) models.PersonalityDNA {
	planets := make([]models.DNAPlanet, 0, len(profileDNA.Facets))
	for _, facet := range profileDNA.Facets {
		planetType := traitPlanetType
		if facet.Kind == "interest" {
			planetType = interestPlanetType
		}
		planets = append(planets, models.DNAPlanet{Key: facet.Key, Name: facet.Name, Type: planetType, Meaning: facet.Meaning, Energy: facet.Energy})
	}
	return models.PersonalityDNA{
		SchemaVersion:  profileDNA.SchemaVersion,
		Archetype:      profileDNA.Archetype,
		SceneName:      profileDNA.SceneName,
		Quote:          profileDNA.Quote,
		ShortNarrative: profileDNA.ShortNarrative,
		TraitScores: models.TraitScores{
			Creativity: profileDNA.TraitScores.Creativity,
			Discipline: profileDNA.TraitScores.Discipline,
			Curiosity:  profileDNA.TraitScores.Curiosity,
			Energy:     profileDNA.TraitScores.Energy,
			Focus:      profileDNA.TraitScores.Focus,
		},
		EnergySignature: models.EnergySignature{Primary: profileDNA.EnergySignature.Primary, Secondary: profileDNA.EnergySignature.Secondary, Intensity: profileDNA.EnergySignature.Intensity},
		Planets:         planets,
		VisualHints: models.VisualHints{
			Theme:         profileDNA.VisualHints.Theme,
			CoreSymbol:    profileDNA.VisualHints.CoreSymbol,
			PaletteIntent: profileDNA.VisualHints.PaletteIntent,
			MotionIntent:  profileDNA.VisualHints.MotionIntent,
		},
	}
}

func worldResponse(bundle repositories.WorldBundle) models.WorldResponse {
	return models.WorldResponse{World: bundle.World, SelectedVariant: selectedVariant(bundle.Variants), Variants: bundle.Variants, PersonalityDNA: bundle.World.PersonalityDNA}
}

func highestVariantNumber(variants []models.WorldVariant) int {
	highestNumber := 0
	for _, variant := range variants {
		if variant.VariantNo > highestNumber {
			highestNumber = variant.VariantNo
		}
	}
	return highestNumber
}

// shareSlugValue flattens the optional slug for transport: an unpublished world
// has no share page to invalidate, and an empty string says so without making
// every caller nil-check.
func shareSlugValue(shareSlug *string) string {
	if shareSlug == nil {
		return ""
	}
	return *shareSlug
}

func selectedVariant(variants []models.WorldVariant) models.WorldVariant {
	for _, variant := range variants {
		if variant.IsSelected {
			return variant
		}
	}
	if len(variants) > 0 {
		return variants[0]
	}
	return models.WorldVariant{}
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var slugBuilder strings.Builder
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			slugBuilder.WriteRune(character)
		case character == ' ' || character == '-' || character == '_':
			if slugBuilder.Len() > 0 && !strings.HasSuffix(slugBuilder.String(), "-") {
				slugBuilder.WriteRune('-')
			}
		}
	}
	return strings.Trim(slugBuilder.String(), "-")
}
