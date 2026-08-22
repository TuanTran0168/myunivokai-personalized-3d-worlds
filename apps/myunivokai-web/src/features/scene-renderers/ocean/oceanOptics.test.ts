import { describe, expect, it } from "vitest";
import { Color } from "three";
import {
  ABYSS_GLOOM,
  CLEAR_WATER,
  DEFAULT_WATER_TYPE,
  JERLOV_WATER_TYPES,
  KEY_LIGHT_FLOOR,
  SKY_HAZE_LINEAR,
  SURFACE_SUN,
  adaptationExposure,
  fogDensityForRange,
  luminousTransmission,
  onePercentBlueDepthMetres,
  sightingRangeMetres,
  transmissionAtDepth,
  waterAttenuation,
  waterPalette,
} from "./oceanOptics";

describe("Jerlov water types", () => {
  it("orders from clearest to most turbid", () => {
    const values = JERLOV_WATER_TYPES.map((entry) => entry.kd475);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it("cannot be clearer than pure seawater", () => {
    // The published Kd for type I is 0.025 at 475 nm, which is already close to
    // the 0.016 floor. Red is where the floor really bites.
    const clearest = waterAttenuation("I");
    expect(clearest.kd[0]).toBeGreaterThanOrEqual(0.3);
    expect(clearest.kd[2]).toBeGreaterThanOrEqual(0.016);
  });

  it("reproduces the numbers oceanographers quote for open ocean", () => {
    // Two independent published facts about clear ocean water:
    //   horizontal visibility in the clearest water is 60-80 m;
    //   the 1% (euphotic) depth of open ocean is famously about 100 m.
    const clearest = waterAttenuation("I");
    expect(sightingRangeMetres(clearest)).toBeGreaterThan(55);
    expect(sightingRangeMetres(clearest)).toBeLessThan(80);

    const openOcean = waterAttenuation("IB");
    expect(onePercentBlueDepthMetres(openOcean)).toBeGreaterThan(80);
    expect(onePercentBlueDepthMetres(openOcean)).toBeLessThan(110);
  });

  it("turns green before it turns dark, and brown at the turbid end", () => {
    // Coastal water is green rather than merely darker because what makes it
    // turbid absorbs blue hardest. At the estuarine end blue attenuation
    // overtakes red, which is why an estuary looks brown.
    const coastal = waterAttenuation("3C");
    expect(coastal.kd[2]).toBeGreaterThan(coastal.kd[1]);

    const estuary = waterAttenuation("9C");
    expect(estuary.kd[2]).toBeGreaterThan(estuary.kd[0]);
  });

  it("loses red first in open ocean, and blue first in an estuary", () => {
    // Red goes first wherever pure seawater dominates -- every open-ocean type.
    for (const type of ["I", "IA", "IB", "II", "III"] as const) {
      const transmission = transmissionAtDepth(waterAttenuation(type), 10);
      expect(transmission[0]).toBeLessThan(transmission[1]);
    }
    // The turbid end inverts it, and that inversion is not a bug: estuarine
    // water transmits red best, which is exactly why it looks brown.
    const estuary = transmissionAtDepth(waterAttenuation("9C"), 3);
    expect(estuary[0]).toBeGreaterThan(estuary[2]);
  });
});

describe("sighting range", () => {
  it("does not depend on depth", () => {
    // The bug this replaced: visibility was a function of how much light was
    // left, so an abyssal world could not show its own seabed. A lamp at two
    // thousand metres reaches exactly as far as it does at twenty.
    const water = waterAttenuation("I");
    const shallow = sightingRangeMetres(water);
    const deep = sightingRangeMetres(water);
    expect(shallow).toBe(deep);
  });

  it("agrees with the fog density that draws it", () => {
    const water = waterAttenuation("II");
    const range = sightingRangeMetres(water);
    expect(fogDensityForRange(range)).toBeCloseTo(1 / range, 10);
  });

  it("shortens monotonically as the water gets dirtier", () => {
    const ranges = JERLOV_WATER_TYPES.map((entry) =>
      sightingRangeMetres(waterAttenuation(entry.type)),
    );
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]).toBeLessThanOrEqual(ranges[i - 1]);
    }
  });
});

describe("water palette", () => {
  it("never goes black, however deep", () => {
    // A black rectangle is physically correct below 1000 m and useless as an
    // image; the value floor is what makes the abyss readable.
    //
    // The threshold here used to be 0.1, which was not an invariant — it was a
    // measurement of a bug. The palette blended toward the abyssal gloom and then
    // RENORMALISED the result back up to the value floor, so the blend could only
    // ever shift the hue and the trench came out as bright as the twilight zone.
    // With the blend applied after normalisation, as the reference does it, the
    // deepest fog settles near 0.85 of the gloom colour's own magnitude.
    const abyss = waterPalette("I", 2500);
    const brightest = Math.max(...abyss.fog);
    expect(brightest).toBeGreaterThan(0.03);
    expect(abyss.luminance).toBeLessThan(0.001);
  });

  it("makes the trench darker than the twilight zone above it", () => {
    // The invariant the 0.1 threshold was standing in for, stated as a RELATION
    // instead of a magnitude. Depth is an axis: each zone must be darker than the
    // one above it, and a constant that pins every deep zone to the same value
    // floor destroys exactly that.
    const twilight = Math.max(...waterPalette("IA", 142).fog);
    const trench = Math.max(...waterPalette("I", 2500).fog);
    expect(trench).toBeLessThan(twilight);
  });

  it("is bright at seventeen metres, not near-black", () => {
    // The regression this guards: multiplying the colour by the surviving light
    // counted depth twice and produced #0A2A49 where real clear water
    // photographs as a luminous blue.
    const shallow = waterPalette("IB", 17);
    expect(Math.max(...shallow.fog)).toBeGreaterThan(0.4);
  });

  it("gets darker with depth but keeps its hue order", () => {
    const near = waterPalette("IB", 5);
    const far = waterPalette("IB", 120);
    expect(Math.max(...far.fog)).toBeLessThan(Math.max(...near.fog));
    expect(far.fog[2]).toBeGreaterThan(far.fog[0]);
  });

  it("defaults to open ocean", () => {
    expect(DEFAULT_WATER_TYPE).toBe("IB");
    expect(luminousTransmission(transmissionAtDepth(waterAttenuation(), 0))).toBeCloseTo(1, 6);
  });
});

describe("adaptation exposure", () => {
  it("does nothing near the surface", () => {
    expect(adaptationExposure(1)).toBeCloseTo(1.02, 6);
  });

  it("lifts a frame that has gone too dark to read", () => {
    expect(adaptationExposure(0)).toBeGreaterThan(1.5);
  });

  it("is monotone in the light available", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const luminance of [0, 0.05, 0.1, 0.2, 0.26, 0.5, 1]) {
      const exposure = adaptationExposure(luminance);
      expect(exposure).toBeLessThanOrEqual(previous);
      previous = exposure;
    }
  });
});

describe("the water keeps its colour at every depth", () => {
  it("never renders grey, however dark it gets", () => {
    // Caught by measuring the rendered frame, not by reading the code: tempering
    // the hue toward WHITE makes every channel converge as transmission goes to
    // zero, so the twilight zone and the abyss came out at saturation 0.02.
    for (const depth of [5, 40, 142, 800, 2500]) {
      const palette = waterPalette("IB", depth);
      const max = Math.max(...palette.fog);
      const min = Math.min(...palette.fog);
      const saturation = max === 0 ? 0 : (max - min) / max;
      expect(saturation).toBeGreaterThan(0.35);
    }
  });

  it("stays blue-dominant in open water at every depth", () => {
    for (const depth of [5, 40, 142, 800, 2500]) {
      const palette = waterPalette("IB", depth);
      expect(palette.fog[2]).toBeGreaterThan(palette.fog[0]);
    }
  });
});

describe("colour constants live in linear space", () => {
  /**
   * The bug this catches, stated plainly: a hex colour's sRGB fractions were used
   * as if they were linear radiance. It survived every existing test because
   * nothing asserted anything about a constant's magnitude, and it survived visual
   * review because its effect is a hue shift rather than an obvious fault — the
   * water simply looked paler than the reference it was copied from.
   *
   * Checked against `three`'s own conversion, because that is what the rest of the
   * renderer does the moment any of these reaches a `Color`.
   */
  it("matches what three.Color does with the same hex", () => {
    for (const [hex, constant] of [
      ["#2C93AC", CLEAR_WATER],
      ["#0A2438", ABYSS_GLOOM],
      ["#FFF4DC", SURFACE_SUN],
      ["#08222E", KEY_LIGHT_FLOOR],
      ["#9BBBD2", SKY_HAZE_LINEAR],
    ] as const) {
      const reference = new Color(hex);
      expect(constant[0]).toBeCloseTo(reference.r, 5);
      expect(constant[1]).toBeCloseTo(reference.g, 5);
      expect(constant[2]).toBeCloseTo(reference.b, 5);
    }
  });

  it("keeps deep water blue rather than grey", () => {
    // The symptom the conversion error produced, as an assertion. In linear space
    // clear water's red channel is a small FRACTION of its blue; treating the sRGB
    // fractions as linear lifts red to a quarter of blue, and a quarter of blue in
    // the red channel is what turns a trench grey-teal.
    expect(CLEAR_WATER[0] / CLEAR_WATER[2]).toBeLessThan(0.1);
    expect(ABYSS_GLOOM[0] / ABYSS_GLOOM[2]).toBeLessThan(0.1);
  });

  it("darkens the abyss faster than it darkens the shallows", () => {
    // Not a constant check but the thing the constants are for: the deep must be
    // measurably darker AND more saturated than the shallows, and it was neither.
    const reef = waterPalette("IB", 8);
    const trench = waterPalette("I", 2448);
    expect(trench.brightness).toBeLessThan(reef.brightness * 0.2);
    const saturation = (fog: readonly number[]) => {
      const peak = Math.max(...fog);
      return peak <= 0 ? 0 : (peak - Math.min(...fog)) / peak;
    };
    expect(saturation(trench.fog)).toBeGreaterThan(0.5);
  });
});
