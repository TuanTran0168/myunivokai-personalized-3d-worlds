package models

// OceanDNA mirrors nature-service's NatureDNA, which in turn mirrors
// universe-service's PersonalityDNA envelope. The semantic layer is landmarks
// — meaningful places in the visitor's own sea — exactly as it is for the
// forest; only their interpretation differs, and that interpretation lives in
// the deterministic builder, never here.
//
// The AI produces semantics only: names, meanings, energies. Every visual
// number comes from the seed in ocean_config_builder.go. There are no
// ocean-specific AI prompts anywhere in the platform — this family consumes
// the same canonical ProfileDNA as the other two.
type OceanDNA struct {
	SchemaVersion   string          `json:"schemaVersion"`
	Archetype       string          `json:"archetype"`
	SceneName       string          `json:"sceneName"`
	Quote           string          `json:"quote"`
	ShortNarrative  string          `json:"shortNarrative"`
	TraitScores     TraitScores     `json:"traitScores"`
	EnergySignature EnergySignature `json:"energySignature"`
	Landmarks       []DNALandmark   `json:"landmarks"`
	VisualHints     VisualHints     `json:"visualHints"`
}

type TraitScores struct {
	Creativity int `json:"creativity"`
	Discipline int `json:"discipline"`
	Curiosity  int `json:"curiosity"`
	Energy     int `json:"energy"`
	Focus      int `json:"focus"`
}

type EnergySignature struct {
	Primary   string `json:"primary"`
	Secondary string `json:"secondary"`
	Intensity int    `json:"intensity"`
}

// DNALandmark is the ocean counterpart of a DNA planet: one meaningful place
// in the user's sea, named from their own interests/traits.
//
// Type is the human-readable provenance label ("Interest Landmark" / "Trait
// Landmark"), the same value nature-service stores. The SCENE kind — kelp
// cathedral, sunken relic, hydrothermal vent — is a separate, seeded draw made
// by the builder, so a landmark's meaning never depends on which shape the
// lottery gave it.
type DNALandmark struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Meaning string `json:"meaning"`
	Energy  int    `json:"energy"`
}

type VisualHints struct {
	Theme         string `json:"theme"`
	CoreSymbol    string `json:"coreSymbol"`
	PaletteIntent string `json:"paletteIntent"`
	MotionIntent  string `json:"motionIntent"`
}
