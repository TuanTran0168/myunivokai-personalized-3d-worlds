package services

import "math"

// The two quantities the renderer was reverse-engineering, moved to where they
// belong.
//
// Until now the frontend inferred both of these: it matched the stored
// visibilityMetres to the nearest real water type, and hashed the world seed
// for a wind speed. That works, but it puts two physical properties of a world
// outside the world's own record — two clients could disagree about them, and
// nothing here could ever answer "what kind of water is this". They are
// derived once, in the builder, and stored, exactly like every other number
// under Water.
//
// Both come from their own PRNG stream, so adding them moved nothing that
// already existed.

// jerlovWaterType is one entry of Jerlov's 1976 optical classification of
// seawater, which ocean optics still uses. kd475 is the published downwelling
// diffuse attenuation coefficient at 475 nm, in m^-1.
type jerlovWaterType struct {
	Name  string
	Kd475 float64
}

// Ordered clearest to most turbid — open ocean I through III, then coastal 1C
// through 9C.
var jerlovWaterTypes = []jerlovWaterType{
	{Name: "I", Kd475: 0.025},
	{Name: "IA", Kd475: 0.038},
	{Name: "IB", Kd475: 0.050},
	{Name: "II", Kd475: 0.085},
	{Name: "III", Kd475: 0.130},
	{Name: "1C", Kd475: 0.200},
	{Name: "3C", Kd475: 0.420},
	{Name: "5C", Kd475: 0.700},
	{Name: "7C", Kd475: 1.200},
	{Name: "9C", Kd475: 2.000},
}

const (
	// pureSeawaterKdGreen is the absorption of pure seawater in the green band,
	// per metre. It is a FLOOR, not a parameter: no water is clearer than this.
	pureSeawaterKdGreen = 0.065
	// pureSeawaterKdBlue is the same for blue, and is what a water type's
	// published kd475 is measured against.
	pureSeawaterKdBlue = 0.016
	// turbidityShapeGreen is how much of a type's added attenuation lands in
	// the green band, relative to blue. Under 1 because what makes water turbid
	// — CDOM and phytoplankton — absorbs hardest at SHORT wavelengths, which is
	// the entire reason coastal water is green while open ocean is blue.
	turbidityShapeGreen = 0.8
	// contrastAttenuationLengths is how far a viewer can see: contrast against
	// a background falls by 1/e per attenuation length and the eye gives up at
	// roughly 2% contrast, which is about 4.6 lengths.
	contrastAttenuationLengths = 4.6
)

// sightingRangeMetres is how far you can see horizontally through a water type.
//
// It does NOT depend on depth. At two thousand metres a lamp reaches exactly as
// far as it does at twenty; what runs out with depth is the sun, not the
// water's clarity.
func sightingRangeMetres(water jerlovWaterType) float64 {
	load := math.Max(0, water.Kd475-pureSeawaterKdBlue)
	kdGreen := pureSeawaterKdGreen + load*turbidityShapeGreen
	return contrastAttenuationLengths / kdGreen
}

// Which water types a zone can be made of.
//
// This is GEOGRAPHY, not depth, and getting that distinction wrong is a real
// error rather than a tuning choice. The first version of this matched the
// water type to the stored VisibilityMetres, which the depth curve derives from
// how much light survives — so an abyssal world at 2431 m, where almost no
// light is left, came out as "3C": turbid COASTAL water, three kilometres from
// any coast. It would have rendered the deep ocean estuary-green.
//
// Clarity and remaining light are two different quantities. A trench is
// unlit AND gin-clear; a harbour at three metres is brilliantly lit and you
// cannot see your own hand. So the water type comes from where the world IS:
//
//   - The shallows can be anything. A reef sits in water from open-ocean clear
//     to properly coastal, and that spread is most of why one reef photograph
//     looks nothing like another.
//   - Open water is open water. A world kilometres from a shelf is in Jerlov I
//     to IB by definition — the turbidity that makes coastal water coastal is
//     river outflow and resuspended sediment, and neither reaches out there.
var waterTypesByZone = map[string][]string{
	ZoneSunlitShallows: {"IB", "II", "III", "1C", "3C"},
	ZoneTwilightReach:  {"I", "IA", "IB"},
	ZoneAbyss:          {"I", "IA", "IB"},
}

// WaterTypeForZone picks the water a world of this zone sits in.
//
// Drawn rather than derived, because two reefs at the same depth genuinely can
// sit in different water and nothing about the depth says which.
func WaterTypeForZone(zone string, roll float64) string {
	candidates, found := waterTypesByZone[zone]
	if !found || len(candidates) == 0 {
		return "IB"
	}
	index := int(roll * float64(len(candidates)))
	if index >= len(candidates) {
		index = len(candidates) - 1
	}
	return candidates[index]
}

// MurkiestWaterTypeForZone is the worst case a zone can hand the renderer.
//
// The boundary rule has to hold for the water a world ACTUALLY gets, and the
// water type is drawn after the depth. Reasoning with the murkiest candidate is
// the conservative direction: a boundary visible in the worst water this zone
// allows is visible in all of it.
func MurkiestWaterTypeForZone(zone string) string {
	candidates, found := waterTypesByZone[zone]
	if !found || len(candidates) == 0 {
		return "IB"
	}
	return candidates[len(candidates)-1]
}

// SightingRangeForWaterType is how far a viewer can see through this water,
// given enough light. Exposed so the renderer and the service cannot disagree
// about it.
func SightingRangeForWaterType(name string) float64 {
	for _, water := range jerlovWaterTypes {
		if water.Name == name {
			return round(sightingRangeMetres(water))
		}
	}
	return round(sightingRangeMetres(jerlovWaterTypes[2]))
}

const (
	// The band a sea is worth looking at in: Beaufort 3 is a gentle breeze with
	// the first scattered whitecaps, Beaufort 6 a strong breeze with extensive
	// foam. Below this the sea is a mirror and the wave field has nothing in it;
	// above it, a world nobody asked for a storm in becomes a storm.
	minimumWindSpeedMetresPerSecond = 5.0
	windSpeedRangeMetresPerSecond   = 8.0
)

// WindSpeedForRoll is the wind at 10 m above the sea, in metres per second.
//
// Wind speed at 10 m is what every marine forecast, every buoy and every paper
// on wave spectra uses, so it is the number to carry — not a wave height, and
// certainly not a per-component amplitude. From it the renderer derives the
// significant wave height (Pierson-Moskowitz 1964), the peak wavelength, and
// the whitecap coverage (Monahan & O'Muircheartaigh 1980). One number in, the
// whole surface out.
func WindSpeedForRoll(roll float64, surgeMultiplier float64) float64 {
	speed := (minimumWindSpeedMetresPerSecond + roll*windSpeedRangeMetresPerSecond) * surgeMultiplier
	return round(clampFloat(speed, minimumWindSpeedMetresPerSecond, minimumWindSpeedMetresPerSecond+windSpeedRangeMetresPerSecond))
}
