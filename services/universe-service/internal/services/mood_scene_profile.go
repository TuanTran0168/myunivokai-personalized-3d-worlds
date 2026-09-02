package services

import "strings"

// moodSceneProfile tunes the deterministic scene numbers by atmospheric mood so
// the user's mood choice has a visible effect on the rendered world. The same
// mapping is mirrored on the frontend preview builder
// (apps/myunivokai-personalization/src/lib/scene.ts, buildPreviewSceneConfig) so the live
// preview and the generated world react to mood in the same direction. Keep the
// two in sync when changing these values.
type moodSceneProfile struct {
	BloomMultiplier    float64
	ParticleMultiplier float64
	MotionMultiplier   float64
	BackgroundColor    string
}

const (
	defaultSceneBackgroundColor = "#050816"
	minimumBloomIntensity       = 0.2
	maximumBloomIntensity       = 1.8
)

var neutralSceneProfile = moodSceneProfile{
	BloomMultiplier:    1.0,
	ParticleMultiplier: 1.0,
	MotionMultiplier:   1.0,
	BackgroundColor:    defaultSceneBackgroundColor,
}

// Keyed by the atmospheric mood values the create form sends.
var moodSceneProfiles = map[string]moodSceneProfile{
	"focused":    {BloomMultiplier: 1.0, ParticleMultiplier: 1.0, MotionMultiplier: 1.0, BackgroundColor: "#050816"},
	"dreamy":     {BloomMultiplier: 1.4, ParticleMultiplier: 1.25, MotionMultiplier: 0.7, BackgroundColor: "#0b0720"},
	"energetic":  {BloomMultiplier: 1.5, ParticleMultiplier: 1.2, MotionMultiplier: 1.5, BackgroundColor: "#140712"},
	"reflective": {BloomMultiplier: 0.65, ParticleMultiplier: 0.7, MotionMultiplier: 0.6, BackgroundColor: "#04070c"},
}

func sceneProfileForMood(mood string) moodSceneProfile {
	if profile, ok := moodSceneProfiles[strings.ToLower(strings.TrimSpace(mood))]; ok {
		return profile
	}
	return neutralSceneProfile
}

func clampFloat(value, minimum, maximum float64) float64 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
