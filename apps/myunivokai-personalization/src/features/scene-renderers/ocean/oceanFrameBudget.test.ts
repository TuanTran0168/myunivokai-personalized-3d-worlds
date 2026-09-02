import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureFrame, type FrameMetrics } from "../../../../e2e/frameMetrics.mjs";

/**
 * WHAT THE OCEAN'S FRAMES ARE ALLOWED TO CONTAIN.
 *
 * This is the check the family was missing, and it is named after the reason it
 * was missing rather than after a metric. Every serious visual bug in this
 * renderer's life was invisible to every test that existed:
 *
 *   - three worlds hundreds of metres apart rendering indistinguishably
 *   - deep water rendering GREY instead of blue, saturation 0.02, because a hue
 *     was tempered toward white instead of toward the water's own colour
 *   - a whole frame clipped flat to white because the post-processing composer
 *     had silently disabled the renderer's tone mapping
 *   - god rays clipping 100% of a reef to pure white, because an additive layer
 *     was being sRGB-encoded before it was summed in
 *   - an abyssal plain measuring 0.549 luma against a reference 0.191, because a
 *     landmark was standing 9.6 m from the lens
 *   - the deepest world in the family drawing the strongest sunlight
 *
 * Not one of those is an exception, a thrown error, or a failed assertion. Each
 * is a number, and each was one number away from obvious. So the numbers are the
 * test.
 *
 * It reads the COMMITTED screenshots rather than rendering anything, which is a
 * deliberate trade. It cannot catch a regression before someone re-shoots — but
 * `e2e/shots` is tracked, so a re-shoot that drifts shows up as a failing build
 * on the commit that contains it, with the offending image in the same diff. The
 * alternative, launching a browser from a unit test, buys earlier detection for a
 * suite nobody runs.
 *
 * Shots are skipped when absent so a fresh clone that has not run Playwright is
 * not a failure; `covers every ocean preset` below is what stops that from
 * quietly becoming zero coverage.
 */

const SHOTS = fileURLToPath(new URL("../../../../e2e/shots/", import.meta.url));

function metricsFor(shot: string, project = "desktop"): FrameMetrics | null {
  const path = `${SHOTS}${project}/${shot}.png`;
  if (!existsSync(path)) return null;
  return measureFrame(path, false);
}

/**
 * Every ocean frame, whatever depth it is at.
 *
 * The bands are wide on purpose. A tolerance tight enough to catch a re-grade is
 * a tolerance that fails on a driver update, and this suite runs against
 * SwiftShader precisely so the numbers are reproducible rather than precise. Each
 * bound is set where a REAL past defect sat, not at the edge of current output.
 */
const UNIVERSAL = {
  // The god rays clipped 100%. The composer tone-mapping bug clipped the frame.
  // 2% is where a highlight has visibly lost its gradient.
  maximumBlown: 0.02,
  // The dive-light-off experiment crushed 65%. Anything past a few per cent is
  // shadow detail thrown away rather than darkness.
  maximumCrush: 0.05,
  // A black rectangle is physically defensible below 1000 m and useless as an
  // image; the palette's value floor exists to prevent exactly this.
  minimumLuma: 0.08,
  // A white wash. Above this the frame has stopped being water.
  maximumLuma: 0.8,
};

/**
 * Per-preset luma, ±0.09.
 *
 * Chosen so the regressions this family has actually produced fail and ordinary
 * variation passes. The defects were +0.358 (abyss lit by a landmark), +0.229
 * (god rays), −0.171 (reef with the window off camera) and −0.152 (above water
 * pitched into the sea) — all far outside. Renderer noise between runs on
 * SwiftShader is under 0.005.
 */
const LUMA_TOLERANCE = 0.09;

/*
 * REBASELINED 2026-09-01, and the reason is the point of the file.
 *
 * schemaVersion 1.5 moved the sunlit shallows from 3-28 m down to 12-32 m and
 * the floor clearance from 2-14 m to 5-10 m, because at 3 m the underwater
 * surface shader has no water column left to be fogged through and a turbid
 * style painted a wall of light overhead. Every one of these five presets is a
 * golden fixture, so all five moved with it, and two moved past this file's
 * tolerance:
 *
 *   ocean-shallow  Reef Crest        14.0 m -> 24.5 m down    luma 0.570 -> 0.432
 *   ocean-surface  Glass Shallows    24.0 m -> 10.1 m up      luma 0.411 -> 0.257
 *
 * A deeper reef is a darker reef and that is the change working. The other
 * three drifted inside tolerance and their numbers moved with them anyway,
 * because a reference that is stale by less than the tolerance is still stale.
 *
 * The numbers below are the MEASURED values of the re-shot frames, not widened
 * bounds. Widening the tolerance to absorb a deliberate change is how this file
 * stops being able to see the next accidental one.
 *
 * This is also the file behaving exactly as its header describes: the re-shoot
 * and the failure landed in the same commit, with the offending images in the
 * same diff.
 */
const PRESETS = [
  // The four DEPTH & MOOD options, one shot each, plus the second sample of the
  // above-water option that brackets its sun band.
  {
    shot: "ocean-surface",
    label: "Glass Shallows, golden hour",
    luma: 0.257,
    // Above water is desaturated by nature: haze, grey sea, pale sky. The floor
    // is here only to catch a frame that has lost colour altogether.
    minimumSaturation: 0.1,
  },
  {
    shot: "ocean-daylight",
    label: "Glass Shallows, midday",
    luma: 0.541,
    minimumSaturation: 0.05,
  },
  {
    shot: "ocean-shallow",
    label: "Reef Crest",
    luma: 0.432,
    // Underwater, so the water must still have a hue. This is the bound that the
    // grey-water bug (saturation 0.02) would have failed.
    minimumSaturation: 0.3,
  },
  {
    shot: "ocean-twilight",
    label: "Mesophotic Current",
    luma: 0.393,
    minimumSaturation: 0.3,
  },
  {
    shot: "ocean-abyss",
    label: "The Abyss",
    luma: 0.136,
    // The trench keeps less hue than the reef but must not go grey. It measured
    // 0.02 once, and 0.60 in the prototype.
    minimumSaturation: 0.12,
  },
] as const;

/** The prototype's own six views, rendered by this app from its parameters. */
const PARITY = [
  { shot: "demo-above-water", luma: 0.635 },
  { shot: "demo-golden-hour", luma: 0.407 },
  { shot: "demo-reef", luma: 0.639 },
  { shot: "demo-open-water", luma: 0.722 },
  { shot: "demo-twilight", luma: 0.257 },
  { shot: "demo-abyssal-plain", luma: 0.205 },
] as const;

describe("what the ocean's frames contain", () => {
  it("covers every ocean preset", () => {
    // The guard on the skip-if-absent behaviour above. Without this, deleting a
    // shot would silently remove it from the budget rather than fail.
    const missing = [...PRESETS, ...PARITY]
      .map((entry) => entry.shot)
      .filter((shot) => metricsFor(shot) === null);
    // Either the suite has been shot or it has not. A PARTIAL set means someone
    // re-shot one view and not the rest, and comparing across that is how the
    // depth axis got measured against two different instruments.
    expect(missing.length === 0 || missing.length === PRESETS.length + PARITY.length).toBe(true);
  });

  for (const preset of [...PRESETS, ...PARITY]) {
    const label = "label" in preset ? `${preset.shot} (${preset.label})` : preset.shot;

    it(`keeps ${label} inside its budget`, () => {
      const metrics = metricsFor(preset.shot);
      if (!metrics) return;

      expect(metrics.blown, `${preset.shot} has clipped highlights`).toBeLessThanOrEqual(
        UNIVERSAL.maximumBlown,
      );
      expect(metrics.crush, `${preset.shot} has crushed shadows`).toBeLessThanOrEqual(
        UNIVERSAL.maximumCrush,
      );
      expect(metrics.luma).toBeGreaterThanOrEqual(UNIVERSAL.minimumLuma);
      expect(metrics.luma).toBeLessThanOrEqual(UNIVERSAL.maximumLuma);
      expect(metrics.luma, `${preset.shot} drifted from ${preset.luma}`).toBeGreaterThan(
        preset.luma - LUMA_TOLERANCE,
      );
      expect(metrics.luma, `${preset.shot} drifted from ${preset.luma}`).toBeLessThan(
        preset.luma + LUMA_TOLERANCE,
      );
      if ("minimumSaturation" in preset) {
        expect(metrics.sat, `${preset.shot} lost its hue`).toBeGreaterThanOrEqual(
          preset.minimumSaturation,
        );
      }
    });
  }

  /**
   * THE ONE ASSERTION THAT IS A RELATION RATHER THAN A MAGNITUDE, and the most
   * valuable one here.
   *
   * Depth is this family's whole axis, so each zone must be darker than the zone
   * above it. That held for the entire life of the renderer and then inverted:
   * the abyss measured 0.385 while its own reef measured 0.380, because a
   * readability floor under the sun's intensity meant the deepest world in the
   * family drew the strongest sunlight, and because an untinted landmark and a
   * lamp with no falloff lit the trench like a swimming pool.
   *
   * No magnitude bound catches that — every individual number was inside a
   * plausible range. Only the ORDER shows it.
   */
  it("keeps the depth axis in order: the deeper world is the darker one", () => {
    const reef = metricsFor("ocean-shallow");
    const twilight = metricsFor("ocean-twilight");
    const abyss = metricsFor("ocean-abyss");
    if (!reef || !twilight || !abyss) return;

    expect(abyss.luma, "the abyss is not darker than the reef").toBeLessThan(reef.luma);
    expect(abyss.luma, "the abyss is not darker than the twilight zone").toBeLessThan(
      twilight.luma,
    );
  });

  /**
   * THE SAME AXIS, AT THE OTHER VIEWPORT.
   *
   * Worth its own case because the mobile build is not the desktop one scaled: it
   * relayouts, drops to `quality: "low"` — fewer instances, a smaller shadow map —
   * and shows the scene in a band across the top of a stacked page. A depth axis
   * that only holds at 1440x900 holds by accident.
   *
   * These numbers were unusable until the measurement window was made to derive
   * from the frame's own width. Applied with the desktop band, all four
   * create-page presets came back within 0.008 luma of each other: the instrument
   * was pointed at furniture.
   */
  // Rebaselined 2026-09-01 with the desktop set, and for the same reason — see
  // the note above PRESETS. Reef Crest moved furthest here too, 0.502 -> 0.340,
  // because it is the preset the depth change moved furthest.
  const MOBILE = [
    { shot: "ocean-surface", luma: 0.283, minimumSaturation: 0.1 },
    { shot: "ocean-daylight", luma: 0.519, minimumSaturation: 0.05 },
    { shot: "ocean-shallow", luma: 0.34, minimumSaturation: 0.3 },
    { shot: "ocean-twilight", luma: 0.364, minimumSaturation: 0.3 },
    { shot: "ocean-abyss", luma: 0.197, minimumSaturation: 0.1 },
  ] as const;

  for (const preset of MOBILE) {
    it(`keeps ${preset.shot} inside its budget on a phone`, () => {
      const metrics = metricsFor(preset.shot, "mobile");
      if (!metrics) return;
      expect(metrics.blown, `${preset.shot} has clipped highlights`).toBeLessThanOrEqual(
        UNIVERSAL.maximumBlown,
      );
      expect(metrics.crush, `${preset.shot} has crushed shadows`).toBeLessThanOrEqual(
        UNIVERSAL.maximumCrush,
      );
      expect(metrics.luma).toBeGreaterThan(preset.luma - LUMA_TOLERANCE);
      expect(metrics.luma).toBeLessThan(preset.luma + LUMA_TOLERANCE);
      expect(metrics.sat, `${preset.shot} lost its hue`).toBeGreaterThanOrEqual(
        preset.minimumSaturation,
      );
    });
  }

  it("keeps the depth axis in order on a phone too", () => {
    const reef = metricsFor("ocean-shallow", "mobile");
    const twilight = metricsFor("ocean-twilight", "mobile");
    const abyss = metricsFor("ocean-abyss", "mobile");
    if (!reef || !twilight || !abyss) return;
    expect(abyss.luma).toBeLessThan(reef.luma);
    expect(abyss.luma).toBeLessThan(twilight.luma);
  });

  /**
   * The prototype's abyssal plain and its reef, side by side, are a factor of
   * three apart in brightness. Ours must be too — a family whose deepest and
   * shallowest frames sit within a few per cent of each other has collapsed its
   * own axis into a colour grade, which is the acceptance criterion this family
   * was signed off against.
   */
  it("keeps the deep and the shallow far apart, not merely ordered", () => {
    const reef = metricsFor("ocean-shallow");
    const abyss = metricsFor("ocean-abyss");
    if (!reef || !abyss) return;
    expect(reef.luma / abyss.luma).toBeGreaterThan(2);
  });
});
