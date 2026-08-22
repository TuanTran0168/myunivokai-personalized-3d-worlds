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
	NatureDNA         NatureDNA    `json:"-"`
	Archetype         string       `json:"archetype"`
	SceneName         string       `json:"sceneName"`
	Quote             string       `json:"quote"`
	ShortNarrative    string       `json:"shortNarrative,omitempty"`
	Visibility        string       `json:"visibility"`
	ShareSlug         *string      `json:"shareSlug"`
	SelectedVariantID *string      `json:"selectedVariantId,omitempty"`
	CreatedAt         time.Time    `json:"createdAt"`
	UpdatedAt         time.Time    `json:"updatedAt"`
	// Revision increments on every mutation and is never rendered to a
	// product client — it exists so the analytics read model can order
	// snapshots that JetStream may deliver twice or out of order.
	Revision int `json:"-"`
}

type WorldVariant struct {
	ID           string            `json:"id"`
	WorldID      string            `json:"worldId,omitempty"`
	VariantNo    int               `json:"variantNo"`
	Seed         string            `json:"seed"`
	Config       ForestSceneConfig `json:"config"`
	ThumbnailURL string            `json:"thumbnailUrl,omitempty"`
	IsSelected   bool              `json:"isSelected"`
	CreatedAt    time.Time         `json:"createdAt"`
}
