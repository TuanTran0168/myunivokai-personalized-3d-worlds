package services

import (
	"fmt"
	"math"
)

// rgbColor is linear-ish 0..1 arithmetic on colours, used only by the depth
// curve. It exists because the ocean family is the one family whose colours
// are COMPUTED from physics rather than picked from a per-season table: the
// forest can list four fog colours because it has four seasons, while an ocean
// has a continuum of depths and no table would cover it.
//
// Deliberately not a public type and deliberately small. Anything beyond
// multiply/scale/add/floor belongs in the renderer, not in a builder whose
// output has to stay byte-stable.
type rgbColor struct {
	Red   float64
	Green float64
	Blue  float64
}

func (color rgbColor) scale(factor float64) rgbColor {
	return rgbColor{Red: color.Red * factor, Green: color.Green * factor, Blue: color.Blue * factor}
}

func (color rgbColor) multiply(other rgbColor) rgbColor {
	return rgbColor{Red: color.Red * other.Red, Green: color.Green * other.Green, Blue: color.Blue * other.Blue}
}

func (color rgbColor) add(other rgbColor) rgbColor {
	return rgbColor{Red: color.Red + other.Red, Green: color.Green + other.Green, Blue: color.Blue + other.Blue}
}

// maximum is a per-channel floor, used for the two legibility floors the depth
// curve documents. It is a maximum rather than a blend so a floor can never
// darken a channel that was already above it.
func (color rgbColor) maximum(other rgbColor) rgbColor {
	return rgbColor{
		Red:   math.Max(color.Red, other.Red),
		Green: math.Max(color.Green, other.Green),
		Blue:  math.Max(color.Blue, other.Blue),
	}
}

// hex renders the colour the way every other config value in this platform
// carries one: an uppercase six-digit triplet. Channels are clamped, because a
// computed colour can overshoot and "#1A2B3C" is the only shape the scene
// schema and the frontend accept.
func (color rgbColor) hex() string {
	return fmt.Sprintf("#%02X%02X%02X", channelByte(color.Red), channelByte(color.Green), channelByte(color.Blue))
}

func channelByte(value float64) int {
	return int(math.Round(clampFloat(value, 0, 1) * 255))
}
