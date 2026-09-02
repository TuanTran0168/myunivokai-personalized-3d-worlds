import { describe, expect, it } from "vitest";
import {
  OCEAN_ZONE_ABYSS,
  OCEAN_ZONE_SUNLIT_SHALLOWS,
  OCEAN_ZONE_TWILIGHT_REACH,
  buildPreviewOceanSceneConfig,
  oceanZoneForDepth,
  sightingRangeForWaterType
} from "./oceanScene";
import { depthAt } from "./oceanDepthCurve";
import type { PreviewSceneInput } from "./scene";

/**
 * The create form's live preview is a SECOND implementation of the ocean
 * builder — the first is ocean-service, in Go. The seeded halves of the two are
 * deliberately only plausible, not identical (the PRNGs differ, exactly as they
 * do for the forest preview). What must not differ is anything the depth curve
 * decides, and oceanDepthCurve.test.ts pins that against the Go builder's own
 * golden fixtures.
 *
 * What this file checks is the other half: that the preview obeys the same
 * RULES the backend does, so a visitor is not shown a sea that could never be
 * generated.
 */

function previewInput(overrides: Partial<PreviewSceneInput> = {}): PreviewSceneInput {
  return {
    nickname: "Mai",
    interests: ["Diving", "Music", "Science"],
    traits: ["curious", "calm", "explorer"],
    mood: "reflective",
    preferredWorldStyle: "aurora",
    favoriteColors: ["#8B5CF6", "#06B6D4"],
    ...overrides
  };
}

const MOODS = ["focused", "dreamy", "energetic", "reflective"];

// Species that need sunlight to live. None may appear in the abyss.
const PHOTOSYNTHETIC_FLORA = new Set([
  "flora-kelp-giant",
  "flora-seagrass",
  "flora-coral-brain",
  "flora-coral-staghorn"
]);

function previewsAcrossMoodsAndNicknames(count: number) {
  const scenes = [];
  for (let index = 0; index < count; index += 1) {
    for (const mood of MOODS) {
      scenes.push(buildPreviewOceanSceneConfig(previewInput({ mood, nickname: `Mai-${index}` })));
    }
  }
  return scenes;
}

describe("the ocean preview builder", () => {
  it("returns an identical config for identical inputs", () => {
    expect(buildPreviewOceanSceneConfig(previewInput())).toEqual(buildPreviewOceanSceneConfig(previewInput()));
  });

  // The create page's untouched-default identity — nickname "Neo", mood
  // "focused" — hashes to ONE fixed seed forever, and that seed's own
  // aboveWaterRoll happens to land underwater (depth +27.15m) rather than on
  // the surface. showCalmSurfaceDefault exists so the landing page can show
  // the calm surface anyway, without touching what a REAL nickname/mood
  // combination rolls once someone actually customizes the form.
  describe("showCalmSurfaceDefault", () => {
    const untouchedDefaultInput = previewInput({
      nickname: "Neo",
      interests: ["Technology", "Design", "AI"],
      traits: ["curious", "builder", "focused"],
      mood: "focused",
      preferredWorldStyle: "cosmic-galaxy",
      favoriteColors: ["#8B5CF6", "#06B6D4"]
    });

    it("rolls underwater for the untouched-default identity when left off", () => {
      const scene = buildPreviewOceanSceneConfig(untouchedDefaultInput);
      expect(scene.depth?.metres).toBeGreaterThanOrEqual(0);
    });

    it("forces the calm surface for that same identity when turned on", () => {
      const scene = buildPreviewOceanSceneConfig(untouchedDefaultInput, { showCalmSurfaceDefault: true });
      expect(scene.depth?.metres).toBeLessThan(0);
      expect(scene.depth?.zone).toBe(OCEAN_ZONE_SUNLIT_SHALLOWS);
    });

    it("never changes the result once real input exists", () => {
      const customised = previewInput({ nickname: "Mai", mood: "focused" });
      expect(buildPreviewOceanSceneConfig(customised, { showCalmSurfaceDefault: false })).toEqual(
        buildPreviewOceanSceneConfig(customised)
      );
    });
  });

  it("stamps the contract keys the renderer registry resolves on", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput());
    expect(scene.sceneType).toBe("ocean");
    expect(scene.schemaVersion).toBe("1.7");
    expect(scene.assets?.catalogVersion).toBe("ocean-1");
    // This family has no sky, so it must never claim an environment map.
    expect(scene.assets?.hdriKey).toBeUndefined();
  });

  it("never labels a depth with a zone that depth is not in", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const metres = scene.depth?.metres ?? 0;
      expect(scene.depth?.zone).toBe(oceanZoneForDepth(metres));
      // A negative depth is a viewer ABOVE the waterline, which is a real value
      // in this family rather than a bug — but it has to be high enough that the
      // horizon separates from the water, and there must still be a seabed under
      // them.
      //
      // The band was 1.4-7.8 m, chosen as "a person's eye height on the water".
      // With wind reaching 13 m/s and Pierson-Moskowitz putting the significant
      // wave height there at 3.6 m, the low end of that band was BELOW the crests:
      // the sea filled the frame, no sky line, and the one view that exists to
      // show the surface showed none. 4-24 m clears the roughest sea this family
      // makes and reaches the height the surface composes at.
      if (metres < 0) {
        expect(scene.depth?.zone).toBe(OCEAN_ZONE_SUNLIT_SHALLOWS);
        expect(-metres).toBeGreaterThanOrEqual(4);
        expect(-metres).toBeLessThanOrEqual(24);
        expect(scene.depth?.seafloorMetres ?? 0).toBeGreaterThan(0);
      }
    }
  });

  // Mirrors TestOnBottomZonesSeeTheirFloorThroughTheirOwnWater in
  // depth_curve_test.go, and exists because nothing on this side used to pin
  // the floor-clearance band at all — the FE/BE mirror was a comment.
  //
  // "In sight" was the wrong bar. A world can place its seabed inside the
  // boundary reach and still have the renderer's own fog term,
  // 1 - exp(-(distance/range)^2), swallow nearly all of it. The old shallows
  // band reached 18 m against 3C water whose sighting range is 11.85 m, which
  // is 90% swallowed: a floor that is technically drawn and effectively absent.
  //
  // Measured against the STORED visibility, which is min(remaining light,
  // water clarity) — so this is stricter than the renderer, which divides by
  // clarity alone. Stricter in the safe direction: it cannot pass something the
  // renderer would then lose.
  it("keeps the seabed legible in every world that is placed on one", () => {
    // Where a floor stops reading as a floor rather than as a suggestion.
    const MAXIMUM_FLOOR_FOG_SWALLOW = 0.6;
    const ON_BOTTOM_ZONES = new Set([OCEAN_ZONE_SUNLIT_SHALLOWS, OCEAN_ZONE_ABYSS]);
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const metres = scene.depth?.metres ?? 0;
      // Above the waterline there is no seabed drawn, so there is nothing to
      // keep legible — see the isAboveWater gate in oceanRig.ts.
      if (metres < 0) continue;
      if (!ON_BOTTOM_ZONES.has(scene.depth?.zone ?? "")) continue;
      const clearanceMetres = (scene.depth?.seafloorMetres ?? 0) - metres;
      const visibilityMetres = scene.water?.visibilityMetres ?? 0;
      expect(visibilityMetres).toBeGreaterThan(0);
      const swallowed = 1 - Math.exp(-Math.pow(clearanceMetres / visibilityMetres, 2));
      expect(swallowed).toBeLessThanOrEqual(MAXIMUM_FLOOR_FOG_SWALLOW);
    }
  });

  // Mirrors TestEachMoodPinsExactlyOneDepth in ocean_config_builder_test.go.
  //
  // This replaced a rate assertion — "above the waterline sometimes, and not
  // usually" — and the replacement is the point rather than a re-tune. A rate is
  // the right assertion for something nobody selects. It is the wrong one for a
  // control: these four moods are the create form's DEPTH & MOOD options, and
  // the underwater zone is a weighted HOME that may drift one zone away —
  // except in the direction that recreated the original bug, which must never
  // happen at all.
  //
  // "The Abyss" drawing the water surface 5% of the time was the original
  // defect, and the clamp below is what makes that combination impossible
  // rather than merely unlikely: forbiddenZone is a hard wall, not a small
  // number.
  //
  // focused's own surface roll (aboveWaterProbability) is checked separately
  // below — here its zone is asserted to stay pinned to the sunlit shallows in
  // EVERY sample regardless of whether that sample surfaces, because driftZone
  // exempts any mood with a nonzero surface probability from zone drift.
  it("keeps every mood inside its clamp, with its home zone as the plurality", () => {
    const expected: Record<string, { mustNeverSurface: boolean; forbiddenZone?: string; homeZone: string }> = {
      focused: { mustNeverSurface: false, homeZone: OCEAN_ZONE_SUNLIT_SHALLOWS },
      energetic: { mustNeverSurface: true, forbiddenZone: OCEAN_ZONE_ABYSS, homeZone: OCEAN_ZONE_SUNLIT_SHALLOWS },
      dreamy: { mustNeverSurface: true, homeZone: OCEAN_ZONE_TWILIGHT_REACH },
      reflective: { mustNeverSurface: true, forbiddenZone: OCEAN_ZONE_SUNLIT_SHALLOWS, homeZone: OCEAN_ZONE_ABYSS }
    };
    const samplesPerMood = 80;
    const covered = new Set<string>();
    for (const [mood, want] of Object.entries(expected)) {
      const zoneCounts: Record<string, number> = {};
      for (let index = 0; index < samplesPerMood; index += 1) {
        const scene = buildPreviewOceanSceneConfig(previewInput({ mood, nickname: `Mai-${index}` }));
        const metres = scene.depth?.metres ?? 0;
        const zone = scene.depth?.zone ?? "";
        if (want.mustNeverSurface) {
          expect(metres < 0, `mood ${mood} at ${metres}m`).toBe(false);
        }
        if (mood === "focused") {
          expect(zone, `mood ${mood} produced zone ${zone} at sample ${index}`).toBe(want.homeZone);
        }
        if (want.forbiddenZone) {
          expect(zone, `mood ${mood} produced the forbidden zone ${want.forbiddenZone} at sample ${index}`).not.toBe(
            want.forbiddenZone
          );
        }
        zoneCounts[zone] = (zoneCounts[zone] ?? 0) + 1;
        covered.add(zone);
      }
      // Plurality, not majority: the home zone's count must be the LARGEST of
      // the three, which is the bar the weight tables are actually tuned to
      // clear. A strict >50% bar is tighter than that (dreamy's own weight is
      // 0.55 of three candidates) and is not what "home" means here.
      const homeCount = zoneCounts[want.homeZone] ?? 0;
      const otherCounts = Object.entries(zoneCounts)
        .filter(([zone]) => zone !== want.homeZone)
        .map(([, count]) => count);
      expect(
        homeCount,
        `mood ${mood}'s home zone ${want.homeZone} was not the plurality: ${JSON.stringify(zoneCounts)}`
      ).toBeGreaterThan(Math.max(0, ...otherCounts));
    }
    for (const zone of [OCEAN_ZONE_SUNLIT_SHALLOWS, OCEAN_ZONE_TWILIGHT_REACH, OCEAN_ZONE_ABYSS]) {
      expect(covered.has(zone), `no mood ever reached ${zone}`).toBe(true);
    }
  });

  it("never puts open water in coastal water", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(40)) {
      if (scene.depth?.zone === OCEAN_ZONE_SUNLIT_SHALLOWS) {
        continue;
      }
      // The turbidity that makes coastal water coastal is river outflow and
      // resuspended sediment, and neither reaches the middle of an ocean.
      expect(["I", "IA", "IB"]).toContain(scene.water?.jerlovWaterType);
    }
  });

  it("gives every world a sea state inside the band the wave spectrum covers", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const wind = scene.water?.windSpeedMetresPerSecond ?? 0;
      // Below Beaufort 3 the sea is a mirror with no wave field in it; above
      // Beaufort 6 every world becomes a storm nobody asked for.
      expect(wind).toBeGreaterThanOrEqual(5);
      expect(wind).toBeLessThanOrEqual(13);
    }
  });

  it("derives the water's optics from the depth curve and nothing else", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(20)) {
      const expected = depthAt(scene.depth?.metres ?? 0);
      // Clarity and weather are excluded on purpose and covered by their own
      // tests above: two worlds at the same depth can legitimately sit in
      // different water under different wind, and neither is a consequence of
      // how deep they are.
      expect({
        fogColor: scene.water?.fogColor,
        fogDensity: scene.water?.fogDensity,
        tintStrength: scene.water?.tintStrength
      }).toEqual({
        fogColor: expected.fogColor,
        fogDensity: expected.fogDensity,
        tintStrength: expected.tintStrength
      });
      expect(scene.water?.visibilityMetres ?? 0).toBeLessThanOrEqual(expected.visibilityMetres + 0.01);
      expect(scene.lighting?.godRayStrength).toBe(expected.godRayStrength);
      expect(scene.lighting?.causticStrength).toBe(expected.causticStrength);
    }
  });

  it("grows nothing photosynthetic where no sunlight arrives", () => {
    let sawAbyss = false;
    for (const scene of previewsAcrossMoodsAndNicknames(40)) {
      if (scene.depth?.zone !== OCEAN_ZONE_ABYSS) {
        continue;
      }
      sawAbyss = true;
      for (const entry of scene.flora?.speciesMix ?? []) {
        expect(PHOTOSYNTHETIC_FLORA.has(entry.modelKey ?? "")).toBe(false);
      }
      // ...and no surface light effects, without the builder ever asking which
      // zone it is in.
      expect(scene.lighting?.godRayStrength).toBe(0);
      expect(scene.lighting?.causticStrength).toBe(0);
    }
    expect(sawAbyss).toBe(true);
  });

  it("puts the hero landmark first and never repeats a kind while others are unused", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput());
    const landmarks = scene.landmarks ?? [];
    expect(landmarks.length).toBeGreaterThanOrEqual(3);
    expect(landmarks[0].kind).toBe("kelpCathedral");
    const kinds = landmarks.map((landmark) => landmark.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const landmark of landmarks) {
      // The invariant is CLEARANCE FROM THE CAMERA, not containment in the
      // basin. It used to be the latter, and the latter is what allowed the bug:
      // the basin is 26-38 m and the camera orbits at 16-24 m, so "inside the
      // basin" was satisfied by a landmark standing exactly where the viewer
      // does. The basin bounds small dressing; the seabed is drawn 680 m across.
      const radius = landmark.radiusFromCenter ?? 0;
      const distance = scene.camera?.distance ?? 0;
      expect(radius).toBeGreaterThanOrEqual(distance + 8);
      expect(radius).toBeLessThanOrEqual(distance + 8 + 26);
    }
  });

  // Mirrors TestLandmarkRingNeverReachesPastTheWatersOwnSightingRange in
  // ocean_config_builder_test.go. The ring's 26 m spread was tuned for
  // composition and never asked how far the water lets a viewer see, so a
  // far-edge roll in turbid shallows placed a landmark several fog
  // e-foldings out — built, textured, and never seen.
  it("never rolls a landmark past the reach its own water allows", () => {
    const ROUNDING_TOLERANCE = 0.01;
    const MAX_SIGHTING_RANGE_FRACTION = 0.9;
    let sawUnconstrainedRing = false;
    let sawPinnedRing = false;
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const landmarks = scene.landmarks ?? [];
      const distance = scene.camera?.distance ?? 0;
      const innerRadius = distance + 8;
      const maximumUsefulRadius =
        sightingRangeForWaterType(scene.water?.jerlovWaterType ?? "IB") * MAX_SIGHTING_RANGE_FRACTION;
      if (maximumUsefulRadius > innerRadius) {
        sawUnconstrainedRing = true;
      } else {
        sawPinnedRing = true;
      }
      const ceiling = Math.max(innerRadius, maximumUsefulRadius);
      for (const landmark of landmarks) {
        const radius = landmark.radiusFromCenter ?? 0;
        expect(radius).toBeGreaterThanOrEqual(innerRadius - ROUNDING_TOLERANCE);
        expect(radius).toBeLessThanOrEqual(ceiling + ROUNDING_TOLERANCE);
      }
    }
    expect(sawUnconstrainedRing).toBe(true);
    expect(sawPinnedRing).toBe(true);
  });

  // Still needed alongside the per-mood test above: pinning each mood to a depth
  // would also satisfy that test if two moods pinned the same zone and a third
  // zone became unreachable from the form entirely.
  it("reaches every zone across the four moods", () => {
    const zones = new Set(previewsAcrossMoodsAndNicknames(40).map((scene) => scene.depth?.zone));
    expect(zones.has(OCEAN_ZONE_SUNLIT_SHALLOWS)).toBe(true);
    expect(zones.has(OCEAN_ZONE_TWILIGHT_REACH)).toBe(true);
    expect(zones.has(OCEAN_ZONE_ABYSS)).toBe(true);
  });

  // The family is "ocean" at every machine-readable layer. "Abyss" is a zone
  // and a landmark kind, never an identifier — a reef config living under an
  // "abyss" name would be a mismatch nobody can rename once a link is public.
  it("names no seed stream after the abyss", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput({ mood: "reflective" }));
    for (const streamSeed of [
      scene.seafloor?.placementSeed,
      scene.flora?.placementSeed,
      scene.bioluminescence?.flickerSeed
    ]) {
      expect(streamSeed).toContain("-ocean-");
      expect(streamSeed).not.toContain("abyss");
    }
  });

  it("gives a giant a distance anchored to the water rather than a fixed number", () => {
    let sawGiant = false;
    for (const scene of previewsAcrossMoodsAndNicknames(40)) {
      for (const giant of scene.fauna?.giants ?? []) {
        sawGiant = true;
        expect(giant.approachDistance ?? 0).toBeGreaterThanOrEqual((scene.water?.visibilityMetres ?? 0) * 0.8 - 0.01);
      }
    }
    expect(sawGiant).toBe(true);
  });
});
