package models

type CreateWorldResponse struct {
	World          World          `json:"world"`
	Variant        WorldVariant   `json:"variant"`
	PersonalityDNA PersonalityDNA `json:"personalityDNA"`
}

type WorldResponse struct {
	World           World          `json:"world"`
	SelectedVariant WorldVariant   `json:"selectedVariant"`
	Variants        []WorldVariant `json:"variants"`
	PersonalityDNA  PersonalityDNA `json:"personalityDNA"`
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
	Config WorldSceneConfig `json:"config"`
}

type PublicDNA struct {
	TraitScores TraitScores `json:"traitScores"`
	Planets     []DNAPlanet `json:"planets"`
}

// WorldDeletion is what deleting a world produces. The flag itself is not worth
// returning - the caller asked for it - but the share slug is: the gateway's
// share cache is keyed by slug, only this service can map a world id to one,
// and without it a world its owner just deleted keeps resolving at its public
// URL for a whole cache TTL. That is the bug that appears only in production.
type WorldDeletion struct {
	ShareSlug string
}

// DeleteResponse is the deletion's wire shape. `deleted` is always true - a
// failure is an error envelope, not a false - and it exists so the response is
// a JSON object with a field rather than an empty body a client has to treat as
// a special case.
type DeleteResponse struct {
	Deleted   bool   `json:"deleted"`
	ShareSlug string `json:"shareSlug,omitempty"`
}
