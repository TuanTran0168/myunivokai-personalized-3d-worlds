package services

import (
	"context"
	"reflect"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/family-platform/go/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
)

func newTestWorldService(t *testing.T) (*WorldService, *repositories.MemoryStore) {
	t.Helper()
	store := repositories.NewMemoryStore()
	serviceConfig := config.Config{PublicWebURL: "http://localhost:41300/nature", ShareSlugLength: 10}
	return NewWorldService(serviceConfig, store, NewForestConfigBuilder()), store
}

func validComposeEnvelope() contracts.Envelope[contracts.ComposeWorldData] {
	return contracts.NewEnvelope("01K0NATUREF1234567890", contracts.ComposeWorldData{
		Family:       contracts.WorldFamilyNature,
		ProfileID:    "27ddcd8a-ea36-4f79-9b7f-b831e29d10c4",
		DNAVersionID: "577c956d-83d6-4a1e-b09a-65f0a69d1c67",
		Profile:      contracts.ProfileSummary{Nickname: "Tuan", Role: "Developer"},
		VisualIntent: contracts.VisualIntent{Mood: "reflective", FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, PreferredWorldStyle: "aurora"},
		ProfileDNA: contracts.ProfileDNA{
			SchemaVersion:  "1.0",
			Archetype:      "Reflective Sage",
			SceneName:      "The Quiet Aurora",
			Quote:          "I move slowly, but I move with meaning.",
			ShortNarrative: "A thoughtful mind that finds depth before direction.",
			TraitScores:    contracts.TraitScores{Creativity: 82, Discipline: 84, Curiosity: 90, Energy: 64, Focus: 88},
			EnergySignature: contracts.EnergySignature{
				Primary: "reflective", Secondary: "focused", Intensity: 72,
			},
			Facets: []contracts.ProfileFacet{
				{Key: "hiking", Name: "Hiking", Kind: "interest", Meaning: "A path where attention becomes calm.", Energy: 90},
				{Key: "music", Name: "Music", Kind: "interest", Meaning: "A rhythm that steadies the day.", Energy: 82},
				{Key: "kind", Name: "Kind", Kind: "trait", Meaning: "A quiet shelter for others.", Energy: 88},
			},
			VisualHints: contracts.VisualHints{Theme: "aurora", CoreSymbol: "moon", PaletteIntent: "teal green", MotionIntent: "slow contemplative"},
		},
	})
}

func TestComposeWorldStoresForestVariant(t *testing.T) {
	service, _ := newTestWorldService(t)
	response, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	if response.World.ID == "" || response.Variant.ID == "" || !response.Variant.IsSelected {
		t.Fatalf("expected persisted selected variant, got %#v", response)
	}
	if !strings.HasPrefix(response.Variant.Seed, "NAT-") {
		t.Fatalf("world seed %q must carry the NAT- prefix", response.Variant.Seed)
	}
	if response.Variant.Config.SceneType != forestSceneType || response.Variant.Config.SchemaVersion != forestSchemaVersion {
		t.Fatalf("expected forest %s config, got %s/%s", forestSchemaVersion, response.Variant.Config.SceneType, response.Variant.Config.SchemaVersion)
	}
	if len(response.Variant.Config.Landmarks) != len(response.NatureDNA.Landmarks) || response.NatureDNA.Landmarks[0].Type != "Interest Landmark" {
		t.Fatalf("unexpected nature DNA mapping: %#v", response.NatureDNA.Landmarks)
	}
}

func TestComposeWorldIsIdempotentForRedelivery(t *testing.T) {
	service, store := newTestWorldService(t)
	first, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("first compose: %v", err)
	}
	second, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("redelivered compose: %v", err)
	}
	if first.World.ID != second.World.ID {
		t.Fatalf("redelivery created a second world: %s != %s", first.World.ID, second.World.ID)
	}
	messages, err := store.PendingOutbox(context.Background(), 10)
	if err != nil || len(messages) != 1 {
		t.Fatalf("expected one completion event, got %d, error %v", len(messages), err)
	}
}

func TestRegenerateVariantIsDeterministicFromStoredDNA(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	regenerated, err := service.RegenerateVariant(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("regenerate variant: %v", err)
	}
	rebuilt := NewForestConfigBuilder().Build(BuildForestConfigInput{
		DNA:       created.NatureDNA,
		Seed:      regenerated.Variant.Seed,
		VariantNo: regenerated.Variant.VariantNo,
		Input:     models.VisualIntent{Mood: "reflective", FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, PreferredWorldStyle: "aurora"},
	})
	if !reflect.DeepEqual(regenerated.Variant.Config, rebuilt) {
		t.Fatal("regenerated config must be reproducible from stored DNA, visual intent, and seed")
	}
}

func TestSelectPublishAndGetPublicWorld(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	regenerated, err := service.RegenerateVariant(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("regenerate variant: %v", err)
	}
	selected, err := service.SelectVariant(context.Background(), created.World.ID, regenerated.Variant.ID, noRequestingAccount)
	if err != nil || !selected.Variant.IsSelected {
		t.Fatalf("select variant: %#v, %v", selected, err)
	}
	published, err := service.PublishWorld(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil || !strings.HasPrefix(published.ShareSlug, "tuan-") {
		t.Fatalf("publish world: %#v, %v", published, err)
	}
	publicWorld, err := service.GetPublicWorld(context.Background(), published.ShareSlug)
	if err != nil || publicWorld.Variant.Config.SceneType != forestSceneType {
		t.Fatalf("get public forest: %#v, %v", publicWorld, err)
	}
}

// Twin of the universe-service test: the gateway's public share cache is keyed by
// slug, so a variant mutation has to hand the slug back or the forest share page
// keeps serving the previous variant until its cache entry expires.
func TestVariantMutationsReturnTheShareSlugForCacheInvalidation(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	regenerated, err := service.RegenerateVariant(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("regenerate variant: %v", err)
	}
	if regenerated.ShareSlug != "" {
		t.Fatalf("unpublished world should report no slug, got %q", regenerated.ShareSlug)
	}
	published, err := service.PublishWorld(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("publish world: %v", err)
	}
	selected, err := service.SelectVariant(context.Background(), created.World.ID, regenerated.Variant.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("select variant: %v", err)
	}
	if selected.ShareSlug != published.ShareSlug {
		t.Fatalf("select returned slug %q, want %q", selected.ShareSlug, published.ShareSlug)
	}
	regeneratedAfterPublish, err := service.RegenerateVariant(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("regenerate variant after publish: %v", err)
	}
	if regeneratedAfterPublish.ShareSlug != published.ShareSlug {
		t.Fatalf("regenerate returned slug %q, want %q", regeneratedAfterPublish.ShareSlug, published.ShareSlug)
	}
}

// noRequestingAccount is the anonymous caller: nil means "no session", and an
// unowned world is mutable by one. Named rather than written as a bare nil so
// a reader of these calls does not have to count parameters to see which one
// it is.
var noRequestingAccount *string
