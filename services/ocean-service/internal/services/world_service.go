package services

import (
	"context"
	"errors"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/config"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/seed"
	"github.com/rs/zerolog/log"
)

const (
	maximumVariantCreateAttempts = 3
	maximumPublishAttempts       = 3
	interestLandmarkType         = "Interest Landmark"
	traitLandmarkType            = "Trait Landmark"
)

type WorldService struct {
	config  config.Config
	store   repositories.Store
	builder *OceanConfigBuilder
}

func NewWorldService(serviceConfig config.Config, store repositories.Store, builder *OceanConfigBuilder) *WorldService {
	return &WorldService{config: serviceConfig, store: store, builder: builder}
}

func (service *WorldService) ComposeWorld(ctx context.Context, envelope contracts.Envelope[contracts.ComposeWorldData]) (models.CreateWorldResponse, error) {
	if err := envelope.Validate(); err != nil {
		return models.CreateWorldResponse{}, err
	}
	if envelope.Data.Family != contracts.WorldFamilyOcean {
		return models.CreateWorldResponse{}, errors.New("ocean service received a non-ocean command")
	}
	oceanDNA := oceanDNAFromProfile(envelope.Data.ProfileDNA)
	worldSeed, err := seed.NewWorldSeed()
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	visualIntent := models.VisualIntent{
		Mood:                envelope.Data.VisualIntent.Mood,
		FavoriteColors:      envelope.Data.VisualIntent.FavoriteColors,
		PreferredWorldStyle: envelope.Data.VisualIntent.PreferredWorldStyle,
	}
	sceneConfig := service.builder.Build(BuildOceanConfigInput{DNA: oceanDNA, Seed: worldSeed, VariantNo: 1, Input: visualIntent})
	world := models.World{
		SourceJobID:    envelope.JobID,
		ProfileID:      envelope.Data.ProfileID,
		DNAVersionID:   envelope.Data.DNAVersionID,
		Nickname:       envelope.Data.Profile.Nickname,
		Role:           envelope.Data.Profile.Role,
		VisualIntent:   visualIntent,
		OceanDNA:       oceanDNA,
		Archetype:      oceanDNA.Archetype,
		SceneName:      oceanDNA.SceneName,
		Quote:          oceanDNA.Quote,
		ShortNarrative: oceanDNA.ShortNarrative,
		Visibility:     "private",
		// Straight from the compose command, which dna-service copied from the
		// generate command, which the gateway stamped from a verified token.
		// Nothing on this path reads it from a request body.
		OwnerAccountID: envelope.Data.OwnerAccountID,
		// Exactly one of the two is ever set: the gateway drops a visitor's
		// anonymous id the moment there is a verified account to name instead.
		// This service does not re-check that, because the check belongs where
		// the token is verified - it stores what the command carried.
		AnonymousID: envelope.Data.AnonymousID,
	}
	variant := models.WorldVariant{VariantNo: 1, Seed: worldSeed, Config: sceneConfig, IsSelected: true}
	bundle, err := service.store.CreateWorld(ctx, world, variant)
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	return models.CreateWorldResponse{World: bundle.World, Variant: selectedVariant(bundle.Variants), OceanDNA: oceanDNA}, nil
}

// ClaimWorlds applies one account's claim to this family's worlds.
//
// The identifiers are validated again here, having been validated at the
// gateway and again in dna-service, and that is not belt-and-braces: this is
// the layer that hands them to a `WHERE` clause in this database. The other
// two validations protect other databases.
func (service *WorldService) ClaimWorlds(ctx context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) error {
	if err := envelope.Validate(); err != nil {
		return err
	}
	if err := envelope.Data.Validate(); err != nil {
		return err
	}
	claimedWorldCount, err := service.store.ClaimWorlds(ctx, envelope)
	if err != nil {
		return err
	}
	// The only observability a claim has - nobody is waiting for the answer,
	// so a claim that matched nothing and one that moved five worlds are
	// otherwise the same silent success. Neither identifier is logged: those
	// two values together are exactly what would tie a person to their worlds.
	log.Info().Int64("claimed_worlds", claimedWorldCount).Msg("anonymous worlds claimed")
	return nil
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
		sceneConfig := service.builder.Build(BuildOceanConfigInput{DNA: bundle.World.OceanDNA, Seed: variantSeed, VariantNo: nextVariantNumber, Input: bundle.World.VisualIntent})
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
		slugBase = "reef"
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

// DeleteWorld is owner-only and reversible for ever. The store decides who may
// do it; this method exists to shape the answer, and the share slug in it is
// what lets the gateway drop a cached share response keyed by a slug no other
// service can derive.
func (service *WorldService) DeleteWorld(ctx context.Context, worldID string, requestingAccountID *string) (models.DeleteResponse, error) {
	deletion, err := service.store.DeleteWorld(ctx, worldID, requestingAccountID)
	if err != nil {
		return models.DeleteResponse{}, err
	}
	return models.DeleteResponse{Deleted: true, ShareSlug: deletion.ShareSlug}, nil
}

func (service *WorldService) GetPublicWorld(ctx context.Context, shareSlug string) (models.PublicWorldResponse, error) {
	bundle, err := service.store.GetPublicWorld(ctx, shareSlug)
	if err != nil {
		return models.PublicWorldResponse{}, err
	}
	variant := selectedVariant(bundle.Variants)
	return models.PublicWorldResponse{
		World:     models.PublicWorld{Nickname: bundle.World.Nickname, Archetype: bundle.World.Archetype, SceneName: bundle.World.SceneName, Quote: bundle.World.Quote, ShortNarrative: bundle.World.OceanDNA.ShortNarrative},
		Variant:   models.PublicVariant{Seed: variant.Seed, Config: variant.Config},
		PublicDNA: models.PublicDNA{TraitScores: bundle.World.OceanDNA.TraitScores, Landmarks: bundle.World.OceanDNA.Landmarks},
	}, nil
}

func oceanDNAFromProfile(profileDNA contracts.ProfileDNA) models.OceanDNA {
	landmarks := make([]models.DNALandmark, 0, len(profileDNA.Facets))
	for _, facet := range profileDNA.Facets {
		landmarkType := traitLandmarkType
		if facet.Kind == "interest" {
			landmarkType = interestLandmarkType
		}
		landmarks = append(landmarks, models.DNALandmark{Key: facet.Key, Name: facet.Name, Type: landmarkType, Meaning: facet.Meaning, Energy: facet.Energy})
	}
	return models.OceanDNA{
		SchemaVersion:   profileDNA.SchemaVersion,
		Archetype:       profileDNA.Archetype,
		SceneName:       profileDNA.SceneName,
		Quote:           profileDNA.Quote,
		ShortNarrative:  profileDNA.ShortNarrative,
		TraitScores:     models.TraitScores{Creativity: profileDNA.TraitScores.Creativity, Discipline: profileDNA.TraitScores.Discipline, Curiosity: profileDNA.TraitScores.Curiosity, Energy: profileDNA.TraitScores.Energy, Focus: profileDNA.TraitScores.Focus},
		EnergySignature: models.EnergySignature{Primary: profileDNA.EnergySignature.Primary, Secondary: profileDNA.EnergySignature.Secondary, Intensity: profileDNA.EnergySignature.Intensity},
		Landmarks:       landmarks,
		VisualHints:     models.VisualHints{Theme: profileDNA.VisualHints.Theme, CoreSymbol: profileDNA.VisualHints.CoreSymbol, PaletteIntent: profileDNA.VisualHints.PaletteIntent, MotionIntent: profileDNA.VisualHints.MotionIntent},
	}
}

func worldResponse(bundle repositories.WorldBundle) models.WorldResponse {
	return models.WorldResponse{World: bundle.World, SelectedVariant: selectedVariant(bundle.Variants), Variants: bundle.Variants, OceanDNA: bundle.World.OceanDNA}
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
