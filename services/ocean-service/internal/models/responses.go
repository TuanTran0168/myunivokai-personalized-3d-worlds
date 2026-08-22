package models

type CreateWorldResponse struct {
	World    World        `json:"world"`
	Variant  WorldVariant `json:"variant"`
	OceanDNA OceanDNA     `json:"oceanDNA"`
}

type WorldResponse struct {
	World           World          `json:"world"`
	SelectedVariant WorldVariant   `json:"selectedVariant"`
	Variants        []WorldVariant `json:"variants"`
	OceanDNA        OceanDNA       `json:"oceanDNA"`
}

// WorldListResponse carries a batch read; each entry has the exact same shape
// as a single GET /worlds/{id} response so clients reuse one normalizer.
type WorldListResponse struct {
	Worlds []WorldResponse `json:"worlds"`
}

// VariantResponse carries a variant mutation. ShareSlug rides along because
// selecting a different variant changes what the public share page renders, and
// the gateway's share cache is keyed by SLUG — only this service can map a world
// id to it. Empty when the world has never been published.
type VariantResponse struct {
	Variant   WorldVariant `json:"variant"`
	ShareSlug string       `json:"shareSlug,omitempty"`
}

type PublishResponse struct {
	ShareSlug string `json:"shareSlug"`
	ShareURL  string `json:"shareUrl"`
}

type PublicWorldResponse struct {
	World     PublicWorld   `json:"world"`
	Variant   PublicVariant `json:"variant"`
	PublicDNA PublicDNA     `json:"publicDNA"`
}

type PublicWorld struct {
	Nickname       string `json:"nickname"`
	Archetype      string `json:"archetype"`
	SceneName      string `json:"sceneName"`
	Quote          string `json:"quote"`
	ShortNarrative string `json:"shortNarrative"`
}

type PublicVariant struct {
	Seed   string           `json:"seed"`
	Config OceanSceneConfig `json:"config"`
}

type PublicDNA struct {
	TraitScores TraitScores   `json:"traitScores"`
	Landmarks   []DNALandmark `json:"landmarks"`
}
