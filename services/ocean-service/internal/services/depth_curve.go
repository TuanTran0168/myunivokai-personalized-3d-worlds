package services

import "math"

// The depth curve is the one piece of this service nothing else in the
// repository has an equivalent of, so it is specified rather than described.
//
// # Why this is not a single exponential
//
// Beer-Lambert with one coefficient does not fit measured seawater. Anchoring
// it on the 1 m value gives k = 0.80/m, which predicts 0.03% of surface light
// at 10 m against a measured 16% — wrong by three orders of magnitude. The
// attenuation coefficient itself FALLS with depth, because by then the
// strongly absorbed wavelengths are already gone and only the ones water
// barely touches are left. A plausible-looking single fit would have produced
// an abyss at snorkelling depth.
//
// So the curve is monotone piecewise-exponential BETWEEN measured anchors,
// with a decay coefficient derived per segment from the anchors themselves.
//
// # Anchors (fraction of just-below-surface downwelling irradiance)
//
//	   0 m  1.00   —
//	   1 m  0.45   —
//	  10 m  0.16   red is gone
//	  40 m  0.05   orange is gone
//	 100 m  0.01   yellow is gone
//	1000 m  0.00   the sunlight floor
//
// # The two rules that keep this safe
//
//  1. This runs in the BUILDER, and only its results are stored. Water colour,
//     fog density, god-ray and caustic strength are plain numbers in the saved
//     config. Re-tuning this file changes new worlds and leaves every existing
//     one exactly as it was rendered — the same guarantee the golden fixtures
//     give every other builder value.
//  2. GodRayStrength and CausticStrength reach zero ON THEIR OWN as depth
//     crosses the sunlight floor. No branch anywhere says "if abyss then
//     disable caustics". That is precisely why one renderer covers a sunlit
//     reef and an abyssal trench without a mode flag.
const (
	// SunlightFloorMetres is where downwelling sunlight stops being a light
	// source at all. It is also the top of the abyss zone, deliberately: that
	// makes "the abyss has no caustics" a consequence of the physics rather
	// than a rule somebody has to remember.
	SunlightFloorMetres = 1000.0

	// MaximumDepthMetres is Challenger Deep, rounded. Depths outside
	// [0, MaximumDepthMetres] clamp rather than extrapolate — an extrapolated
	// exponential produces negative light, and a negative fog density is a
	// renderer crash rather than a wrong picture.
	MaximumDepthMetres = 11000.0
)

// lightAnchor is one measured point on the curve.
type lightAnchor struct {
	Metres   float64
	Fraction float64
}

// lightAnchors must stay sorted by depth and strictly decreasing in fraction.
// depthCurveAnchorsAreOrdered asserts both, because an out-of-order edit here
// would silently produce a non-monotone curve.
var lightAnchors = []lightAnchor{
	{Metres: 0, Fraction: 1.00},
	{Metres: 1, Fraction: 0.45},
	{Metres: 10, Fraction: 0.16},
	{Metres: 40, Fraction: 0.05},
	{Metres: 100, Fraction: 0.01},
}

// Per-wavelength death depths, in metres. Below its death depth a band
// contributes exactly nothing — which is what makes a red coral read
// brown-grey at 30 m without anyone hand-picking a brown.
//
// Red/orange/yellow are the measured ones. Green and blue are extended to the
// visually meaningful limits: green is effectively gone by a quarter of a
// kilometre, blue survives right down to the sunlight floor, which is why
// everything deep is blue before it is black.
const (
	redDeathMetres    = 10.0
	orangeDeathMetres = 40.0
	yellowDeathMetres = 100.0
	greenDeathMetres  = 250.0
	blueDeathMetres   = SunlightFloorMetres
)

// SpectralSurvival is how much of each band is left at a depth, in [0, 1].
// It is exposed as named bands rather than as RGB because the physics is
// per-wavelength and the RGB mapping below is an interpretation of it — a
// screen's red channel carries orange energy too.
type SpectralSurvival struct {
	Red    float64
	Orange float64
	Yellow float64
	Green  float64
	Blue   float64
}

// DepthResponse is everything the water and lighting sections of a config are
// derived from. Every field here ends up STORED, never recomputed at render
// time.
type DepthResponse struct {
	// LightFraction is the curve itself: surviving downwelling irradiance.
	LightFraction float64
	// Brightness is LightFraction compressed perceptually. Light falls off far
	// faster than the eye reads it falling off, so driving colour straight
	// from LightFraction makes 10 m look like a cave.
	Brightness float64
	Spectral   SpectralSurvival

	FogColor         string
	FogDensity       float64
	VisibilityMetres float64
	TintStrength     float64

	SurfaceLightColor string
	AmbientColor      string
	GodRayStrength    float64
	CausticStrength   float64
	BaseExposure      float64
}

// Reference colours the curve interprets. These are the only hand-picked
// colours in the family's lighting: everything else is this trio put through
// the physics above.
var (
	// clearWaterColor is what clean seawater looks like under full white
	// light, just below the surface.
	clearWaterColor = rgbColor{Red: 0.55, Green: 0.86, Blue: 0.92}
	// abyssalFloorColor is what is left when no sunlight arrives at all. It is
	// not black: even a lightless sea reads as a very dark blue rather than as
	// an unlit void, and a pure black would make the whole scene depend on the
	// Bloom pass to be visible.
	abyssalFloorColor = rgbColor{Red: 0.012, Green: 0.035, Blue: 0.078}
	// surfaceSunColor is daylight before the water touches it.
	surfaceSunColor = rgbColor{Red: 1.00, Green: 0.97, Blue: 0.90}
	// keyLightFloorColor is a legibility floor, stated as such: physics puts
	// the directional key at zero below the sunlight floor, and a scene with
	// no key light at all loses the shape of everything in it. The floor is
	// dim enough that bioluminescence still reads as the brightest thing in
	// an abyssal world.
	keyLightFloorColor = rgbColor{Red: 0.06, Green: 0.12, Blue: 0.20}
	// ambientFloorColor does the same job for fill light.
	ambientFloorColor = rgbColor{Red: 0.020, Green: 0.050, Blue: 0.090}
)

const (
	// brightnessCompression is the perceptual exponent applied to
	// LightFraction. 0.30 is close to the cube root the eye's lightness
	// response follows.
	brightnessCompression = 0.30

	// Horizontal visibility, which FogDensity is 1/visibility of — so at this
	// distance an object is 63% obscured, and legibility runs out somewhere
	// past it rather than at it.
	//
	// These numbers were far too small until the fog was actually connected.
	// The family shipped with scene.fog === null, so nothing ever rendered
	// them; the moment fog worked, a 38 m ceiling over a basin 36 m across put
	// the middle of every reef at 46% haze and turned clear tropical water into
	// soup. Clear oceanic water has a horizontal visual range of roughly 30-80
	// m, and a reef on a good day is at the top of that — the water is supposed
	// to be the thing you CAN see through.
	//
	// The floor stays low: the deep sea is not merely dark, it is turbid with
	// marine snow, and its short sight line is doing real work.
	minimumVisibilityMetres = 14.0
	visibilityMetresRange   = 76.0

	minimumTintStrength = 0.15
	maximumTintStrength = 0.95

	// GodRayStrength and CausticStrength are RENDERER parameters in 0..1, not
	// irradiances, so they are the light fraction times a gain. The physics
	// owns the shape of the falloff and the depth at which it hits zero; the
	// gain owns only how strongly the renderer expresses what is left. Set to
	// saturate in the first few metres, still be clearly present at the bottom
	// of the reef band (~0.3 at 28 m) and be negligible by 100 m.
	godRayGain  = 4.00
	causticGain = 3.20

	baseExposureAtSurface = 1.00
	exposureDepthGain     = 0.35
)

// DepthAt evaluates the whole curve at one depth. It is a pure function of
// depth: no seed, no mood, no randomness. Two worlds at the same depth get the
// same water, and that is what makes the three depth zones read as one
// continuous sea rather than as three hand-authored presets.
func DepthAt(metres float64) DepthResponse {
	depth := clampFloat(metres, 0, MaximumDepthMetres)
	lightFraction := lightFractionAtDepth(depth)
	brightness := 0.0
	if lightFraction > 0 {
		brightness = clampFloat(math.Exp(brightnessCompression*math.Log(lightFraction)), 0, 1)
	}
	spectral := spectralSurvivalAtDepth(depth)
	spectralRGB := spectral.asRGBMultiplier()

	// The water's own colour, dimmed by how much light is left and shifted by
	// which bands are left, settling onto the abyssal floor colour as the last
	// of it goes.
	fog := clearWaterColor.scale(brightness).multiply(spectralRGB).add(abyssalFloorColor.scale(1 - brightness))
	surfaceLight := surfaceSunColor.multiply(spectralRGB).scale(brightness).maximum(keyLightFloorColor)
	ambient := fog.scale(0.55).maximum(ambientFloorColor)

	visibility := minimumVisibilityMetres + visibilityMetresRange*brightness

	return DepthResponse{
		// LightFraction, Brightness and Spectral are intermediates: they are
		// what the stored values below are derived FROM, and are returned
		// unrounded so the monotonicity test measures the curve rather than
		// its rounding.
		LightFraction:     lightFraction,
		Brightness:        brightness,
		Spectral:          spectral,
		FogColor:          fog.hex(),
		FogDensity:        roundToThousandths(1.0 / visibility),
		VisibilityMetres:  round(visibility),
		TintStrength:      round(clampFloat(1-brightness, minimumTintStrength, maximumTintStrength)),
		SurfaceLightColor: surfaceLight.hex(),
		AmbientColor:      ambient.hex(),
		// Both of these are the light fraction itself, gained. They are
		// therefore exactly zero at and below the sunlight floor without any
		// depth test — see the package comment.
		GodRayStrength:  round(clampFloat(lightFraction*godRayGain, 0, 1)),
		CausticStrength: round(clampFloat(lightFraction*causticGain, 0, 1)),
		BaseExposure:    round(baseExposureAtSurface + exposureDepthGain*(1-brightness)),
	}
}

// lightFractionAtDepth is the piecewise curve. Between two anchors it decays
// exponentially with the coefficient those two anchors imply; below the last
// anchor it continues with that coefficient AND is ramped linearly to exactly
// zero at the sunlight floor, so "no sunlight below 1000 m" is an equality
// rather than an approximation.
func lightFractionAtDepth(depth float64) float64 {
	if depth <= 0 {
		return 1
	}
	for index := 1; index < len(lightAnchors); index++ {
		previous, current := lightAnchors[index-1], lightAnchors[index]
		if depth <= current.Metres {
			coefficient := math.Log(previous.Fraction/current.Fraction) / (current.Metres - previous.Metres)
			return previous.Fraction * math.Exp(-coefficient*(depth-previous.Metres))
		}
	}
	last := lightAnchors[len(lightAnchors)-1]
	if depth >= SunlightFloorMetres {
		return 0
	}
	// The coefficient of the final measured segment, continued.
	previous := lightAnchors[len(lightAnchors)-2]
	coefficient := math.Log(previous.Fraction/last.Fraction) / (last.Metres - previous.Metres)
	decayed := last.Fraction * math.Exp(-coefficient*(depth-last.Metres))
	ramp := 1 - (depth-last.Metres)/(SunlightFloorMetres-last.Metres)
	return decayed * ramp
}

// spectralSurvivalAtDepth applies a smoothstep to zero on each band at its own
// death depth. Smoothstep rather than a linear ramp because a band fading out
// linearly produces a visible edge as it crosses zero.
func spectralSurvivalAtDepth(depth float64) SpectralSurvival {
	return SpectralSurvival{
		Red:    bandSurvival(depth, redDeathMetres),
		Orange: bandSurvival(depth, orangeDeathMetres),
		Yellow: bandSurvival(depth, yellowDeathMetres),
		Green:  bandSurvival(depth, greenDeathMetres),
		Blue:   bandSurvival(depth, blueDeathMetres),
	}
}

func bandSurvival(depth, deathMetres float64) float64 {
	if depth >= deathMetres {
		return 0
	}
	if depth <= 0 {
		return 1
	}
	return 1 - smoothstep(depth/deathMetres)
}

// asRGBMultiplier maps five bands onto three channels. A display's red channel
// carries orange energy as well as red, and its green channel carries yellow,
// so each channel is a weighted mix rather than a single band.
func (survival SpectralSurvival) asRGBMultiplier() rgbColor {
	return rgbColor{
		Red:   0.65*survival.Red + 0.35*survival.Orange,
		Green: 0.45*survival.Yellow + 0.55*survival.Green,
		Blue:  survival.Blue,
	}
}

func smoothstep(t float64) float64 {
	t = clampFloat(t, 0, 1)
	return t * t * (3 - 2*t)
}
