import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAXIMUM_DEPTH_METRES,
  ORANGE_DEATH_METRES,
  RED_DEATH_METRES,
  SUNLIGHT_FLOOR_METRES,
  YELLOW_DEATH_METRES,
  depthAt,
  lightFractionAtDepth,
  spectralSurvivalAtDepth
} from "./oceanDepthCurve";

/**
 * The depth curve's cross-language contract, in executable form.
 *
 * The curve is implemented twice — once in Go (ocean-service, which decides
 * what gets STORED) and once here (the create form's live preview, which has to
 * promise the same water). There is no compiler between them. A one-character
 * change to an anchor, a gain or a colour constant would leave both sides
 * working and quietly disagreeing, and the visitor would meet a preview that
 * lies about the world it is about to generate.
 *
 * These fixtures are the only thing that notices. They are the SAME FILES the
 * Go golden test writes, read here rather than copied, so there is one artefact
 * and not two.
 *
 * A note on floating point: both sides round to two or three decimals before
 * storing, and the colour channels round to a byte. Go's and V8's exp/log can
 * in principle differ in the last bit, which would only matter if a value
 * landed exactly on a rounding boundary. If this suite ever fails on a digit
 * nobody edited, that — and not a mistake — is what to look for.
 */
// The two surface fixtures matter as much as the four below the waterline: the
// negative half of the depth axis was covered by no fixture in either language,
// which is how an above-water view stayed unreachable while both builders agreed
// perfectly about everything they were being asked about.
const GOLDEN_FIXTURE_PATHS = [
  "reflective",
  "focused",
  "dreamy",
  "energetic",
  "surface-golden-hour",
  "surface-daylight"
].map((name) =>
  fileURLToPath(
    new URL(`../../../../services/ocean-service/internal/services/testdata/ocean-golden-${name}.json`, import.meta.url)
  )
);

type OceanGoldenFixture = {
  depth: { metres: number; zone: string };
  water: { fogColor: string; fogDensity: number; visibilityMetres: number; tintStrength: number };
  lighting: {
    surfaceLightColor: string;
    godRayStrength: number;
    causticStrength: number;
    ambientColor: string;
    exposure: number;
  };
};

function readGoldenFixtures(): { name: string; fixture: OceanGoldenFixture }[] {
  return GOLDEN_FIXTURE_PATHS.map((path) => ({
    name: path.split(/[\\/]/).pop() ?? path,
    fixture: JSON.parse(readFileSync(path, "utf8")) as OceanGoldenFixture
  }));
}

describe("ocean depth curve", () => {
  it("reproduces every stored water value the Go builder wrote", () => {
    const fixtures = readGoldenFixtures();
    // A glob or a path that silently matched nothing would make this suite
    // report success while checking no world at all.
    expect(fixtures.length).toBe(6);
    for (const { name, fixture } of fixtures) {
      const response = depthAt(fixture.depth.metres);
      // The colour, the fog and the tint are pure consequences of depth and
      // must reproduce exactly. The water type and the wind are NOT — they are
      // clarity and weather, drawn by the builder from their own stream — so
      // they are asserted separately below rather than reproduced here.
      expect({
        name,
        fogColor: fixture.water.fogColor,
        fogDensity: fixture.water.fogDensity,
        tintStrength: fixture.water.tintStrength
      }).toEqual({
        name,
        fogColor: response.fogColor,
        fogDensity: response.fogDensity,
        tintStrength: response.tintStrength
      });
      // Visibility is the SHORTER of the two limits: how much light is left,
      // and how clear the water is. Storing a number past either would put the
      // fog and the water type in disagreement, and the renderer reads both.
      expect(fixture.water.visibilityMetres).toBeLessThanOrEqual(response.visibilityMetres + 0.01);
    }
  });

  it("reproduces every depth-derived lighting value the Go builder wrote", () => {
    for (const { name, fixture } of readGoldenFixtures()) {
      const response = depthAt(fixture.depth.metres);
      expect({
        name,
        surfaceLightColor: fixture.lighting.surfaceLightColor,
        ambientColor: fixture.lighting.ambientColor,
        godRayStrength: fixture.lighting.godRayStrength,
        causticStrength: fixture.lighting.causticStrength
      }).toEqual({
        name,
        surfaceLightColor: response.surfaceLightColor,
        ambientColor: response.ambientColor,
        godRayStrength: response.godRayStrength,
        causticStrength: response.causticStrength
      });
      // Exposure is the one lighting value with a seeded jitter on top of the
      // curve, so it is checked as a bound rather than an equality: the stored
      // number must sit inside one jitter of the depth-derived base.
      expect(fixture.lighting.exposure).toBeGreaterThanOrEqual(response.baseExposure - 0.001);
      expect(fixture.lighting.exposure).toBeLessThanOrEqual(response.baseExposure + 0.1 + 0.001);
    }
  });

  it("covers all three depth zones, so the fixtures pin more than one sea", () => {
    const zones = new Set(readGoldenFixtures().map(({ fixture }) => fixture.depth.zone));
    expect([...zones].sort()).toEqual(["abyss", "sunlitShallows", "twilightReach"]);
  });

  it("reproduces the measured anchors", () => {
    const anchors: [number, number][] = [
      [0, 1.0],
      [1, 0.45],
      [10, 0.16],
      [40, 0.05],
      [100, 0.01]
    ];
    for (const [metres, fraction] of anchors) {
      expect(lightFractionAtDepth(metres)).toBeCloseTo(fraction, 9);
    }
    expect(lightFractionAtDepth(SUNLIGHT_FLOOR_METRES)).toBe(0);
  });

  // The mistake this curve exists to avoid, kept as a test so nobody
  // "simplifies" it back into one exponential.
  it("is not a single exponential, which would miss 10 m by orders of magnitude", () => {
    const coefficientFromOneMetre = -Math.log(0.45);
    const naiveAtTenMetres = Math.exp(-coefficientFromOneMetre * 10);
    expect(naiveAtTenMetres).toBeLessThan(0.16 / 100);
    expect(lightFractionAtDepth(10)).toBeCloseTo(0.16, 9);
  });

  it("never lets light increase with depth", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let metres = 0; metres <= 2000; metres += 1) {
      const current = lightFractionAtDepth(metres);
      expect(current).toBeLessThanOrEqual(previous);
      expect(current).toBeGreaterThanOrEqual(0);
      previous = current;
    }
  });

  it("kills each band at its own death depth", () => {
    expect(spectralSurvivalAtDepth(RED_DEATH_METRES).red).toBe(0);
    expect(spectralSurvivalAtDepth(RED_DEATH_METRES - 0.5).red).toBeGreaterThan(0);
    expect(spectralSurvivalAtDepth(ORANGE_DEATH_METRES).orange).toBe(0);
    expect(spectralSurvivalAtDepth(ORANGE_DEATH_METRES - 0.5).orange).toBeGreaterThan(0);
    expect(spectralSurvivalAtDepth(YELLOW_DEATH_METRES).yellow).toBe(0);
    expect(spectralSurvivalAtDepth(YELLOW_DEATH_METRES - 0.5).yellow).toBeGreaterThan(0);
  });

  it("puts god rays and caustics at exactly zero below the sunlight floor", () => {
    for (const metres of [SUNLIGHT_FLOOR_METRES, SUNLIGHT_FLOOR_METRES + 1, 2500, MAXIMUM_DEPTH_METRES]) {
      expect(depthAt(metres).godRayStrength).toBe(0);
      expect(depthAt(metres).causticStrength).toBe(0);
    }
    expect(depthAt(5).godRayStrength).toBeGreaterThan(0);
    expect(depthAt(5).causticStrength).toBeGreaterThan(0);
  });

  it("clamps depths outside the real range rather than extrapolating", () => {
    expect(depthAt(-100)).toEqual(depthAt(0));
    expect(depthAt(MAXIMUM_DEPTH_METRES + 5000)).toEqual(depthAt(MAXIMUM_DEPTH_METRES));
    expect(depthAt(MAXIMUM_DEPTH_METRES).fogDensity).toBeGreaterThan(0);
  });
});
