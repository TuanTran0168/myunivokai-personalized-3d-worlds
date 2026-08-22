package services

import (
	"math"
	"testing"
)

// The depth curve is the only genuinely new maths in this service, and the
// only place where a wrong answer still looks completely plausible on screen.
// These five tests are its specification in executable form.

// 1. Every measured anchor reproduces its measured value.
func TestDepthCurveReproducesEveryMeasuredAnchor(t *testing.T) {
	const tolerance = 1e-9
	for _, anchor := range lightAnchors {
		got := DepthAt(anchor.Metres).LightFraction
		if math.Abs(got-anchor.Fraction) > tolerance {
			t.Fatalf("light at %.0f m = %.6f, want the measured %.2f", anchor.Metres, got, anchor.Fraction)
		}
	}
	if got := DepthAt(SunlightFloorMetres).LightFraction; got != 0 {
		t.Fatalf("light at the sunlight floor = %v, want exactly 0", got)
	}
}

// This is the mistake the curve exists to avoid, kept as a test so nobody
// "simplifies" the piecewise curve back into one exponential. Anchoring
// Beer-Lambert on the 1 m measurement gives k = 0.80/m, which predicts 0.03%
// of surface light at 10 m against a measured 16% — wrong by three orders of
// magnitude, and entirely believable if you never check it.
func TestASingleExponentialWouldMissTheMeasurementsByOrdersOfMagnitude(t *testing.T) {
	coefficientFromOneMetre := -math.Log(0.45)
	naiveAtTenMetres := math.Exp(-coefficientFromOneMetre * 10)
	measuredAtTenMetres := 0.16
	if naiveAtTenMetres > measuredAtTenMetres/100 {
		t.Fatalf("the naive single-exponential fit predicts %.6f at 10 m, which is no longer far enough from the measured %.2f for this test to mean anything", naiveAtTenMetres, measuredAtTenMetres)
	}
	if got := DepthAt(10).LightFraction; math.Abs(got-measuredAtTenMetres) > 1e-9 {
		t.Fatalf("the real curve gives %.6f at 10 m, want the measured %.2f", got, measuredAtTenMetres)
	}
}

// 2. Light never increases with depth. Sampled at one metre across the whole
// range a world can be placed in, plus a kilometre beyond the sunlight floor.
func TestLightNeverIncreasesWithDepth(t *testing.T) {
	previous := math.Inf(1)
	for metres := 0.0; metres <= 2000; metres++ {
		current := DepthAt(metres).LightFraction
		if current > previous {
			t.Fatalf("light rose from %.9f to %.9f between %.0f m and %.0f m", previous, current, metres-1, metres)
		}
		if current < 0 {
			t.Fatalf("light went negative (%.9f) at %.0f m", current, metres)
		}
		previous = current
	}
}

// 3. Each band is gone at its own death depth and stays gone. This is what
// makes a red coral read brown-grey at 30 m without anyone authoring a brown.
func TestEachSpectralBandIsGoneAtItsDeathDepth(t *testing.T) {
	bands := []struct {
		name        string
		deathMetres float64
		read        func(SpectralSurvival) float64
	}{
		{"red", redDeathMetres, func(s SpectralSurvival) float64 { return s.Red }},
		{"orange", orangeDeathMetres, func(s SpectralSurvival) float64 { return s.Orange }},
		{"yellow", yellowDeathMetres, func(s SpectralSurvival) float64 { return s.Yellow }},
		{"green", greenDeathMetres, func(s SpectralSurvival) float64 { return s.Green }},
		{"blue", blueDeathMetres, func(s SpectralSurvival) float64 { return s.Blue }},
	}
	for _, band := range bands {
		t.Run(band.name, func(t *testing.T) {
			if got := band.read(DepthAt(0).Spectral); got != 1 {
				t.Fatalf("%s at the surface = %v, want 1", band.name, got)
			}
			justAbove := band.read(DepthAt(band.deathMetres - 0.5).Spectral)
			if justAbove <= 0 {
				t.Fatalf("%s died early: %v at %.1f m", band.name, justAbove, band.deathMetres-0.5)
			}
			for _, metres := range []float64{band.deathMetres, band.deathMetres + 1, band.deathMetres * 2, MaximumDepthMetres} {
				if got := band.read(DepthAt(metres).Spectral); got != 0 {
					t.Fatalf("%s at %.1f m = %v, want exactly 0 at and below %.0f m", band.name, metres, got, band.deathMetres)
				}
			}
		})
	}
}

// 4. God rays and caustics reach zero on their own. There is no depth test
// anywhere in the builder or the renderer that switches them off — this is
// what lets one renderer cover a sunlit reef and an abyssal trench without a
// mode flag, so it has to be true rather than merely intended.
func TestGodRaysAndCausticsAreExactlyZeroBelowTheSunlightFloor(t *testing.T) {
	for _, metres := range []float64{SunlightFloorMetres, SunlightFloorMetres + 1, 2500, MaximumDepthMetres} {
		response := DepthAt(metres)
		if response.GodRayStrength != 0 {
			t.Fatalf("god rays at %.0f m = %v, want exactly 0", metres, response.GodRayStrength)
		}
		if response.CausticStrength != 0 {
			t.Fatalf("caustics at %.0f m = %v, want exactly 0", metres, response.CausticStrength)
		}
	}
	// ...and they must still be there in the shallows, or the test above would
	// pass on a curve that is zero everywhere.
	if shallow := DepthAt(5); shallow.GodRayStrength <= 0 || shallow.CausticStrength <= 0 {
		t.Fatalf("a reef at 5 m has no god rays or caustics: %#v", shallow)
	}
}

// 5. Depths outside the real range clamp rather than extrapolate. An
// extrapolated exponential produces negative light, and a negative fog density
// is a renderer crash rather than a wrong picture.
func TestDepthsOutsideTheRealRangeClamp(t *testing.T) {
	if DepthAt(-100) != DepthAt(0) {
		t.Fatal("a negative depth must clamp to the surface")
	}
	if DepthAt(MaximumDepthMetres+5000) != DepthAt(MaximumDepthMetres) {
		t.Fatal("a depth past Challenger Deep must clamp rather than extrapolate")
	}
	deepest := DepthAt(MaximumDepthMetres)
	if deepest.FogDensity <= 0 || deepest.VisibilityMetres <= 0 {
		t.Fatalf("clamped depth produced an unrenderable water section: %#v", deepest)
	}
}

// Colours are computed rather than picked here, so the one thing worth
// asserting is that every computed colour is still the shape the scene schema
// and the frontend accept.
func TestEveryComputedColourIsAHexTriplet(t *testing.T) {
	for metres := 0.0; metres <= MaximumDepthMetres; metres += 37 {
		response := DepthAt(metres)
		for name, value := range map[string]string{
			"fogColor":          response.FogColor,
			"surfaceLightColor": response.SurfaceLightColor,
			"ambientColor":      response.AmbientColor,
		} {
			if len(value) != 7 || value[0] != '#' {
				t.Fatalf("%s at %.0f m = %q, want a #RRGGBB triplet", name, metres, value)
			}
			for _, character := range value[1:] {
				if !((character >= '0' && character <= '9') || (character >= 'A' && character <= 'F')) {
					t.Fatalf("%s at %.0f m = %q, which is not uppercase hexadecimal", name, metres, value)
				}
			}
		}
	}
}

// The anchor table is edited by hand. An out-of-order or non-decreasing edit
// would silently produce a non-monotone curve, and the monotonicity test above
// would then be reporting on a table nobody meant to write.
func TestDepthCurveAnchorsAreOrdered(t *testing.T) {
	for index := 1; index < len(lightAnchors); index++ {
		previous, current := lightAnchors[index-1], lightAnchors[index]
		if current.Metres <= previous.Metres {
			t.Fatalf("anchor %d is not deeper than the one before it: %v then %v", index, previous, current)
		}
		if current.Fraction >= previous.Fraction {
			t.Fatalf("anchor %d is not darker than the one before it: %v then %v", index, previous, current)
		}
	}
	if lightAnchors[len(lightAnchors)-1].Metres >= SunlightFloorMetres {
		t.Fatal("the last measured anchor must sit above the sunlight floor, or the ramp to zero has no room to run")
	}
}

// TestOnBottomZonesCanActuallySeeTheirFloor is the test that would have caught
// the number this family shipped wrong: the abyssal clearance band ran to 26 m
// while visibility in the abyss is about 12 m, so worlds declared to be sitting
// on the seabed could not see it. It sweeps each on-bottom zone's whole depth
// band rather than sampling, because the failure was at one end of the range.
func TestOnBottomZonesCanActuallySeeTheirFloor(t *testing.T) {
	const sightMultiplier = 1.5 // BOUNDARY_SIGHT_MULTIPLIER in OceanRenderer.tsx
	for _, zone := range onBottomZones {
		depthBand := depthBandByZone[zone]
		clearanceBand := floorClearanceBandByZone[zone]
		for step := 0; step <= 100; step++ {
			metres := depthBand.Minimum + (depthBand.Maximum-depthBand.Minimum)*float64(step)/100
			sightLimit := DepthAt(metres).VisibilityMetres * sightMultiplier
			if clearanceBand.Maximum > sightLimit {
				t.Fatalf("zone %s at %.1f m: worst-case clearance %.1f m exceeds the sight limit %.1f m, so a world placed on the seabed would render no seabed",
					zone, metres, clearanceBand.Maximum, sightLimit)
			}
		}
	}
}

// The twilight reach must fail that same check — its floor is kilometres down
// and is supposed to be invisible. A band that crept into sight would quietly
// give the midwater a bottom again.
func TestTheTwilightReachHasNoFloorInSight(t *testing.T) {
	const sightMultiplier = 1.5
	band := depthBandByZone[ZoneTwilightReach]
	clearance := floorClearanceBandByZone[ZoneTwilightReach]
	for step := 0; step <= 100; step++ {
		metres := band.Minimum + (band.Maximum-band.Minimum)*float64(step)/100
		sightLimit := DepthAt(metres).VisibilityMetres * sightMultiplier
		if clearance.Minimum <= sightLimit {
			t.Fatalf("twilight at %.1f m: best-case clearance %.1f m is within the sight limit %.1f m; open water would show a seabed",
				metres, clearance.Minimum, sightLimit)
		}
	}
}
