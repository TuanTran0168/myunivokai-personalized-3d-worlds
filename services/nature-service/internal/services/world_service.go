package services

import (
	"context"
	"errors"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/seed"
	"github.com/rs/zerolog/log"
)

const (
	maximumVariantCreateAttempts = 3
	maximumPublishAttempts       = 3
	interestLandmarkType         = "Interest Landmark"
	traitLandmarkType            = "Trait Landmark"
)

// sharePagePathPrefix is where the web app serves a published world, BELOW the
// family prefix that PUBLIC_WEB_URL already carries. The full route is
// /{family}/share/worlds/{slug}, declared once in
// apps/myunivokai-personalization/src/lib/worldRoutes.ts.
//
// It is a named constant because the literal it replaces was written three
// times, in three services, and all three were missing the `worlds/` segment -
// so every share link this platform has ever handed out was a 404. A path that
// only the frontend knows the shape of is a path the backend gets to guess at.
const sharePagePathPrefix = "/share/worlds/"


type WorldService struct {
	config  config.Config
	store   repositories.Store
	builder *ForestConfigBuilder
}

func NewWorldService(serviceConfig config.Config, store repositories.Store, builder *ForestConfigBuilder) *WorldService {
	return &WorldService{config: serviceConfig, store: store, builder: builder}
}

func (service *WorldService) ComposeWorld(ctx context.Context, envelope contracts.Envelope[contracts.ComposeWorldData]) (models.CreateWorldResponse, error) {
	if err := envelope.Validate(); err != nil {
		return models.CreateWorldResponse{}, err
	}
	if envelope.Data.Family != contracts.WorldFamilyNature {
		return models.CreateWorldResponse{}, errors.New("nature service received a non-nature command")
	}
	natureDNA := natureDNAFromProfile(envelope.Data.ProfileDNA)
	worldSeed, err := seed.NewWorldSeed()
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	visualIntent := models.VisualIntent{
		Mood:                envelope.Data.VisualIntent.Mood,
		FavoriteColors:      envelope.Data.VisualIntent.FavoriteColors,
		PreferredWorldStyle: envelope.Data.VisualIntent.PreferredWorldStyle,
	}
	sceneConfig := service.builder.Build(BuildForestConfigInput{DNA: natureDNA, Seed: worldSeed, VariantNo: 1, Input: visualIntent})
	world := models.World{
		SourceJobID:    envelope.JobID,
		ProfileID:      envelope.Data.ProfileID,
		DNAVersionID:   envelope.Data.DNAVersionID,
		Nickname:       envelope.Data.Profile.Nickname,
		Role:           envelope.Data.Profile.Role,
		VisualIntent:   visualIntent,
		NatureDNA:      natureDNA,
		Archetype:      natureDNA.Archetype,
		SceneName:      natureDNA.SceneName,
		Quote:          natureDNA.Quote,
		ShortNarrative: natureDNA.ShortNarrative,
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
	return models.CreateWorldResponse{World: bundle.World, Variant: selectedVariant(bundle.Variants), NatureDNA: natureDNA}, nil
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

// GetWorld answers the maker's own world page, and it is an OWNERSHIP-CHECKED
// read rather than an open one. What it returns is strictly more than the share
// page is allowed to show - the nickname, the role, every variant and the whole
// DNA snapshot, where a share response is redacted down to PublicWorld,
// PublicVariant and PublicDNA - so serving it to whoever holds the id handed a
// stranger the private version of a world the redaction exists to protect.
//
// The public way to see somebody else's world is the share slug, which is what
// the world page's own Share panel copies. `/worlds/{id}` is the maker's
// editing surface: it carries Regenerate, Publish and Delete.
func (service *WorldService) GetWorld(ctx context.Context, worldID string, requestingAccountID *string) (models.WorldResponse, error) {
	bundle, err := service.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.WorldResponse{}, err
	}
	if err := repositories.WorldReadPermitted(bundle.World.OwnerAccountID, requestingAccountID); err != nil {
		return models.WorldResponse{}, err
	}
	return worldResponse(bundle), nil
}

// GetWorlds is the gallery's batch read, and it FILTERS where GetWorld refuses.
//
// The difference is not a softer rule, it is the same rule applied to a request
// that names many worlds instead of one. A single unreadable id must not blank
// a whole gallery - and the client already handles a short answer, because an
// id the family service does not know has always been absent from the result
// rather than an error. Fixing this by refusing the batch would have turned one
// stale entry in localStorage, on a shared device or after signing into a
// second account, into an empty page with nothing to explain it.
func (service *WorldService) GetWorlds(ctx context.Context, worldIDs []string, requestingAccountID *string) (models.WorldListResponse, error) {
	bundles, err := service.store.GetWorldsByIDs(ctx, worldIDs)
	if err != nil {
		return models.WorldListResponse{}, err
	}
	worlds := make([]models.WorldResponse, 0, len(bundles))
	for _, bundle := range bundles {
		if repositories.WorldReadPermitted(bundle.World.OwnerAccountID, requestingAccountID) != nil {
			continue
		}
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
		sceneConfig := service.builder.Build(BuildForestConfigInput{DNA: bundle.World.NatureDNA, Seed: variantSeed, VariantNo: nextVariantNumber, Input: bundle.World.VisualIntent})
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
		slugBase = "grove"
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
			return models.PublishResponse{ShareSlug: *world.ShareSlug, ShareURL: strings.TrimRight(service.config.PublicWebURL, "/") + sharePagePathPrefix + *world.ShareSlug}, nil
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
		World:     models.PublicWorld{Nickname: bundle.World.Nickname, Archetype: bundle.World.Archetype, SceneName: bundle.World.SceneName, Quote: bundle.World.Quote, ShortNarrative: bundle.World.NatureDNA.ShortNarrative},
		Variant:   models.PublicVariant{Seed: variant.Seed, Config: variant.Config},
		PublicDNA: models.PublicDNA{TraitScores: bundle.World.NatureDNA.TraitScores, Landmarks: bundle.World.NatureDNA.Landmarks},
	}, nil
}

func natureDNAFromProfile(profileDNA contracts.ProfileDNA) models.NatureDNA {
	landmarks := make([]models.DNALandmark, 0, len(profileDNA.Facets))
	for _, facet := range profileDNA.Facets {
		landmarkType := traitLandmarkType
		if facet.Kind == "interest" {
			landmarkType = interestLandmarkType
		}
		landmarks = append(landmarks, models.DNALandmark{Key: facet.Key, Name: facet.Name, Type: landmarkType, Meaning: facet.Meaning, Energy: facet.Energy})
	}
	return models.NatureDNA{
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
	return models.WorldResponse{World: bundle.World, SelectedVariant: selectedVariant(bundle.Variants), Variants: bundle.Variants, NatureDNA: bundle.World.NatureDNA}
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
