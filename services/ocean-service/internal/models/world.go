package models

import "time"

type VisualIntent struct {
	Mood                string   `json:"mood"`
	FavoriteColors      []string `json:"favoriteColors"`
	PreferredWorldStyle string   `json:"preferredWorldStyle"`
}

type World struct {
	ID                string       `json:"id"`
	SourceJobID       string       `json:"-"`
	ProfileID         string       `json:"-"`
	DNAVersionID      string       `json:"-"`
	Nickname          string       `json:"nickname"`
	Role              string       `json:"role,omitempty"`
	VisualIntent      VisualIntent `json:"-"`
	OceanDNA          OceanDNA     `json:"-"`
	Archetype         string       `json:"archetype"`
	SceneName         string       `json:"sceneName"`
	Quote             string       `json:"quote"`
	ShortNarrative    string       `json:"shortNarrative,omitempty"`
	Visibility        string       `json:"visibility"`
	ShareSlug         *string      `json:"shareSlug"`
	SelectedVariantID *string      `json:"selectedVariantId,omitempty"`
	CreatedAt         time.Time    `json:"createdAt"`
	UpdatedAt         time.Time    `json:"updatedAt"`
	// OwnerAccountID is the account this world belongs to, or nil for a world
	// nobody has claimed. Nil is the normal case and always will be: every
	// world made before ownership existed is nil, and so is every world made
	// by a visitor who has not signed in. It is never rendered to a product
	// client - whether a world is yours is answered by the list it arrived in,
	// not by the world's own payload - and it is deliberately absent from the
	// analytics snapshot, per that plan's data boundary.
	OwnerAccountID *string `json:"-"`
	// AnonymousID is which visitor made this world before it was claimed, and
	// the claim clears it. Never rendered either, for a stronger reason than
	// the owner id: it is the claim's only proof, so a URL carrying it would
	// let whoever received a shared link take the world.
	AnonymousID *string `json:"-"`
	// Revision increments on every mutation and is never rendered to a
	// product client — it exists so the analytics read model can order
	// snapshots that JetStream may deliver twice or out of order.
	Revision int `json:"-"`
}

type WorldVariant struct {
	ID           string           `json:"id"`
	WorldID      string           `json:"worldId,omitempty"`
	VariantNo    int              `json:"variantNo"`
	Seed         string           `json:"seed"`
	Config       OceanSceneConfig `json:"config"`
	ThumbnailURL string           `json:"thumbnailUrl,omitempty"`
	IsSelected   bool             `json:"isSelected"`
	CreatedAt    time.Time        `json:"createdAt"`
}
