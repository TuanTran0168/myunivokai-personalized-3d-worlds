package contracts

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestEnvelopeContainsOnlyGenericTopLevelFields(t *testing.T) {
	envelope := NewEnvelope("01K0ABCDEF1234567890", GenerateDNAData{
		Family: WorldFamilyUniverse,
		Input:  validWorldInput(),
	})
	payload, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if len(decoded) != 3 {
		t.Fatalf("expected exactly three top-level fields, got %d", len(decoded))
	}
	for _, fieldName := range []string{"jobId", "timestamp", "data"} {
		if _, found := decoded[fieldName]; !found {
			t.Fatalf("missing generic envelope field %q", fieldName)
		}
	}
}

func TestContractFixturesUseTheGenericEnvelope(t *testing.T) {
	fixturePaths := []string{
		"../fixtures/dna-generate-command.v1.json",
		"../fixtures/universe-compose-command.v1.json",
	}
	for _, fixturePath := range fixturePaths {
		fixturePayload, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("read %s: %v", fixturePath, err)
		}
		var envelope map[string]json.RawMessage
		if err := json.Unmarshal(fixturePayload, &envelope); err != nil {
			t.Fatalf("decode %s: %v", fixturePath, err)
		}
		if len(envelope) != 3 || envelope["jobId"] == nil || envelope["timestamp"] == nil || envelope["data"] == nil {
			t.Fatalf("%s must contain only jobId, timestamp and data; got %v", fixturePath, envelope)
		}
	}
}

func TestJSONSchemasAreValidDocuments(t *testing.T) {
	schemaPaths := []string{
		"../schemas/message-envelope.schema.json",
		"../schemas/personality-dna.schema.json",
		"../schemas/profile-dna.schema.json",
		"../schemas/world-input.schema.json",
		"../schemas/world-scene-config.schema.json",
		"../scenes/forest-scene-config.schema.json",
	}
	for _, schemaPath := range schemaPaths {
		schemaPayload, err := os.ReadFile(schemaPath)
		if err != nil {
			t.Fatalf("read %s: %v", schemaPath, err)
		}
		var schemaDocument map[string]any
		if err := json.Unmarshal(schemaPayload, &schemaDocument); err != nil {
			t.Fatalf("decode %s: %v", schemaPath, err)
		}
		if schemaDocument["$schema"] == nil {
			t.Fatalf("%s does not declare a JSON Schema dialect", schemaPath)
		}
	}
}

func TestWorldInputValidationPreservesExistingBoundary(t *testing.T) {
	input := validWorldInput()
	if details := input.Validate(WorldFamilyUniverse); len(details) != 0 {
		t.Fatalf("expected valid input, got %#v", details)
	}
	input.Goal = "short"
	if details := input.Validate(WorldFamilyUniverse); len(details) != 1 || details[0].Field != "goal" {
		t.Fatalf("expected goal validation detail, got %#v", details)
	}
}

func TestWorldStyleIsValidatedAgainstItsOwnFamily(t *testing.T) {
	// The whole point of making this per-family: "nebula" is a real universe
	// and a nonsense forest, and until now both were accepted everywhere.
	input := validWorldInput()
	input.PreferredWorldStyle = "nebula"
	if details := input.Validate(WorldFamilyUniverse); len(details) != 0 {
		t.Fatalf("nebula must be a valid universe style, got %#v", details)
	}
	details := input.Validate(WorldFamilyNature)
	if len(details) != 1 || details[0].Field != "preferredWorldStyle" {
		t.Fatalf("nebula must be rejected for the forest, got %#v", details)
	}

	input.PreferredWorldStyle = "mistwood"
	if details := input.Validate(WorldFamilyNature); len(details) != 0 {
		t.Fatalf("mistwood must be a valid forest style, got %#v", details)
	}
	if details := input.Validate(WorldFamilyOcean); len(details) != 1 {
		t.Fatalf("mistwood must be rejected for the ocean, got %#v", details)
	}
}

func TestEveryFamilyDefaultStyleIsOneOfItsOwn(t *testing.T) {
	// A default outside its family's own set would fail validation on the very
	// first world created after a family gains styles.
	for _, family := range []WorldFamily{WorldFamilyUniverse, WorldFamilyNature, WorldFamilyOcean} {
		style := DefaultWorldStyleForFamily(family)
		if !WorldStyleAllowedForFamily(family, style) {
			t.Fatalf("%s default style %q is not in its own set", family, style)
		}
	}
}

func TestAnEmptyWorldStyleStaysReadable(t *testing.T) {
	// Worlds stored before their family had styles carry no style at all, and
	// rejecting those would make old records unreadable.
	input := validWorldInput()
	input.PreferredWorldStyle = ""
	for _, family := range []WorldFamily{WorldFamilyUniverse, WorldFamilyNature, WorldFamilyOcean} {
		if details := input.Validate(family); len(details) != 0 {
			t.Fatalf("%s rejected an empty style: %#v", family, details)
		}
	}
}

func TestEnvelopeValidationRejectsMissingMetadata(t *testing.T) {
	envelope := Envelope[struct{}]{Timestamp: time.Now().UTC()}
	if err := envelope.Validate(); err == nil {
		t.Fatal("expected empty job id to fail")
	}
}

func validWorldInput() WorldInput {
	return WorldInput{
		Nickname:            "Neo",
		Role:                "Explorer",
		Interests:           []string{"AI", "Design", "Music"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a meaningful personal world.",
		Mood:                "focused",
		FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
}
