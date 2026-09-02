import { Color } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";

// Deterministic forest geometry helpers shared by every forest component.
// All scatter/shape decisions derive from the placement seeds embedded in the
// config (the MilkyWayConfig.Seed pattern): same seed, same forest — on every
// device, on every visit. Each helper opens its OWN suffixed stream so adding
// draws to one never shifts another.

const HILL_SHAPE_SEED_SUFFIX = "-hills";
const PATH_SHAPE_SEED_SUFFIX = "-path";

export const DEFAULT_CLEARING_RADIUS = 9.5;
export const DEFAULT_TREELINE_RADIUS = 40;
const DEFAULT_HILL_AMPLITUDE = 1.4;
const DEFAULT_HILL_FREQUENCY = 0.05;

const FULL_CIRCLE_RADIANS = Math.PI * 2;

// The clearing floor stays flat so landmarks and animals read clearly; hills
// fade in across this band beyond the clearing edge.
const CLEARING_FLATTEN_INNER_FRACTION = 0.65;
const CLEARING_FLATTEN_OUTER_FRACTION = 1.45;

// Distant terrain: beyond the treeline the ground swells into forested hills
// that rise toward the horizon, so a zoomed-out view meets a ridgeline
// silhouette instead of the flat edge of a finite slab. Multiples of the
// treeline radius.
const DISTANT_RISE_INNER_FRACTION = 0.85;
const DISTANT_RISE_OUTER_FRACTION = 2.6;
const DISTANT_HILL_BASE_RISE = 7.0;
const DISTANT_HILL_UNDULATION = 9.0;
const DISTANT_HILL_FREQUENCY = 0.05;

// Path ribbon shape: a gently S-curving dirt line from the clearing to the
// treeline.
const PATH_CURVE_PHASE_RANGE_RADIANS = FULL_CIRCLE_RADIANS;
const MINIMUM_PATH_CURVE_AMPLITUDE_RADIANS = 0.12;
const PATH_CURVE_AMPLITUDE_RANGE_RADIANS = 0.18;
const PATH_CURVE_RADIAL_FREQUENCY = 0.16;

// --- Water bodies ------------------------------------------------------------
// The lake is the hero of the clearing, not an ornament in it — the owner's
// reference photos are a wide sheet of water filling the valley floor. At this
// size it no longer fits inside the terrain's naturally flat zone, so
// createTerrainHeightSampler CARVES a basin for it (see LAKE_BED_DEPTH). That
// carve is what lets the surface stay planar, and planarity is what keeps
// MeshReflectorMaterial valid.
// Sized against the TREELINE, not just the clearing. At 1.0x the clearing the
// lake was ~26 units across inside an 80-unit forest, which reads as a puddle in
// a wood however good the surface is: scale is judged relative to the scene, and
// nothing that small can be a lake. The ceiling is the tree band — trees start at
// (max shoreline + planting clearance), and that has to leave the forest room to
// still be a forest.
const LAKE_RADIUS_FRACTION_OF_CLEARING = 1.35;
// How far past the water's edge the ground climbs back to its natural height.
const LAKE_SHORE_BLEND_WIDTH = 2.2;
// How far the bed sits below the water plane. Only has to beat the local hill
// amplitude so no terrain pokes through the surface.
const LAKE_BED_DEPTH = 1.8;
// How far inside the shoreline the bed reaches full depth — the shallow shelf
// that makes the edge read as a beach rather than a step.
const LAKE_BED_SHELF_WIDTH = 3.0;
/**
 * Bank kept clear of TREES (not of grass, ferns or rocks — those run to the
 * waterline, and a bare ring reads worse than a wooded one). It lives here
 * rather than in the renderer because the opening camera stands inside this
 * band: if the two numbers drift apart the camera ends up behind a trunk.
 * Widened from 2.8 to give that camera room — see forestShoreCameraFraming,
 * whose standoff is clamped to stay inside it.
 */
export const LAKE_SHORE_PLANTING_BUFFER = 4.5;

// Islands. An unbroken sheet of water reads as a puddle however large it is;
// something standing out of it is one of the strongest "this is a lake" cues
// there is, and it costs nothing but a bump in the height field — the water
// surface is a sheet at a fixed height, so any terrain rising past it simply
// emerges. No extra mesh, no hole to cut in the water.
const LAKE_ISLAND_SEED_SUFFIX = "-lake-islands";
const MAXIMUM_LAKE_ISLAND_COUNT = 3;
const LAKE_ISLAND_RADIUS_RANGE = { minimum: 1.6, maximum: 3.4 };
// Clear of WATER_SURFACE_HEIGHT (0.07) by enough that wave troughs never wash
// the whole islet away.
const LAKE_ISLAND_PEAK_HEIGHT = 0.75;
// Kept off the exact centre (where the deep tint is darkest) and away from the
// shore (where an islet just looks like a lumpy bank), as a fraction of the
// local shore radius.
const LAKE_ISLAND_INNER_FRACTION = 0.22;
const LAKE_ISLAND_OUTER_FRACTION = 0.62;
const LAKE_ISLAND_RIM_SAMPLES = 16;
const LAKE_ISLAND_SHORE_MARGIN = 1.2;
const LAKE_ISLAND_PULL_IN_STEPS = 8;

type LakeIsland = { x: number; z: number; radius: number };

function createLakeIslands(terrain: ForestTerrainConfig | undefined, outline: WaterOutline): LakeIsland[] {
  const nextRandomValue = randomFromSeed((terrain?.placementSeed ?? "forest-terrain") + LAKE_ISLAND_SEED_SUFFIX);
  const meanRadius = lakeRadiusFromTerrain(terrain);
  // 1..MAXIMUM islands — never zero, so every lake gets the cue.
  const islandCount = 1 + Math.floor(nextRandomValue() * MAXIMUM_LAKE_ISLAND_COUNT);
  const islands: LakeIsland[] = [];
  for (let islandIndex = 0; islandIndex < islandCount; islandIndex += 1) {
    const angle = nextRandomValue() * FULL_CIRCLE_RADIANS;
    const shoreRadius = meanRadius * outline.radiusFactorAt(-angle);
    const radialFraction =
      LAKE_ISLAND_INNER_FRACTION + nextRandomValue() * (LAKE_ISLAND_OUTER_FRACTION - LAKE_ISLAND_INNER_FRACTION);
    const radius =
      LAKE_ISLAND_RADIUS_RANGE.minimum +
      nextRandomValue() * (LAKE_ISLAND_RADIUS_RANGE.maximum - LAKE_ISLAND_RADIUS_RANGE.minimum);
    // Pull the islet inward until its WHOLE RIM clears the shore, testing the
    // rim rather than estimating from the centre's shore radius. Estimating
    // fails badly now that bays reach 0.3x the mean while headlands reach 1.5x:
    // an islet sitting comfortably inside a headland can still have its far side
    // in the bay next door, where it merges with the bank into a peninsula —
    // which is not the cue it is placed for.
    const rimClearsShore = (centreDistance: number): boolean => {
      for (let rimIndex = 0; rimIndex < LAKE_ISLAND_RIM_SAMPLES; rimIndex += 1) {
        const rimAngle = (rimIndex / LAKE_ISLAND_RIM_SAMPLES) * FULL_CIRCLE_RADIANS;
        const x = Math.cos(angle) * centreDistance + Math.cos(rimAngle) * radius;
        const z = Math.sin(angle) * centreDistance + Math.sin(rimAngle) * radius;
        const shoreAtRim = meanRadius * outline.radiusFactorAt(waterOutlineAngleAt(x, z));
        if (Math.hypot(x, z) > shoreAtRim - LAKE_ISLAND_SHORE_MARGIN) {
          return false;
        }
      }
      return true;
    };
    let distanceFromCentre = shoreRadius * radialFraction;
    let attemptsRemaining = LAKE_ISLAND_PULL_IN_STEPS;
    while (attemptsRemaining > 0 && distanceFromCentre > 0 && !rimClearsShore(distanceFromCentre)) {
      distanceFromCentre *= 0.8;
      attemptsRemaining -= 1;
    }
    // The centre always has room: the outline floor keeps the shore at least
    // MINIMUM_WATER_OUTLINE_FACTOR out, which clears the largest islet.
    if (!rimClearsShore(distanceFromCentre)) {
      distanceFromCentre = 0;
    }
    islands.push({
      x: Math.cos(angle) * distanceFromCentre,
      z: Math.sin(angle) * distanceFromCentre,
      radius
    });
  }
  return islands;
}

const RIVER_SHAPE_SEED_SUFFIX = "-river";
/** Half width of the river channel away from the lake, in world units. */
export const RIVER_HALF_WIDTH = 1.55;
const RIVER_MEANDER_AMPLITUDE = 5.5;
const RIVER_MEANDER_WAVELENGTH = 30;
// Stops short of DISTANT_RISE_INNER_FRACTION so the channel never has to climb
// the far ridgeline it would otherwise run straight up.
const RIVER_SPAN_FRACTION_OF_TREELINE = 0.82;

export function lakeShapeSeedFromTerrain(terrain?: ForestTerrainConfig): string {
  return `${terrain?.placementSeed ?? "forest-terrain"}-lake`;
}

/** MEAN radius. The organic outline swings around it — see maximumLakeRadius. */
export function lakeRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return clearingRadiusFromTerrain(terrain) * LAKE_RADIUS_FRACTION_OF_CLEARING;
}

/**
 * The furthest the shoreline ever reaches. THIS is the number anything placed
 * near the lake must clear — using the mean radius instead puts objects in the
 * water wherever the outline bulges.
 */
export function maximumLakeRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return lakeRadiusFromTerrain(terrain) * maximumOutlineRadiusFactor();
}

/**
 * SIGNED distance to the shoreline: negative inside the water, positive on dry
 * land, zero exactly at the edge. The terrain carve needs the sign — a clamped
 * distance makes the bed flat right up to the shoreline, which leaves the water
 * plane perched on a vertical wall the depth of the lake.
 */
export function createLakeSignedEdgeDistanceSampler(
  terrain?: ForestTerrainConfig
): (x: number, z: number) => number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  const meanRadius = lakeRadiusFromTerrain(terrain);
  return (x: number, z: number) =>
    Math.hypot(x, z) - meanRadius * outline.radiusFactorAt(waterOutlineAngleAt(x, z));
}

/** Distance from a point to the lake's water edge; 0 anywhere inside it. */
export function createLakeEdgeDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  const signedEdgeDistanceSampler = createLakeSignedEdgeDistanceSampler(terrain);
  return (x: number, z: number) => Math.max(0, signedEdgeDistanceSampler(x, z));
}

/**
 * World XZ -> the angle the outline was authored in. The water mesh is built in
 * local XY and laid flat with a -PI/2 X rotation, which maps local (x, y) to
 * world (x, -y); so world angle atan2(z, x) is the NEGATED authoring angle.
 * Getting this backwards silently mirrors the shoreline, and then every
 * exclusion test is wrong exactly where the outline bulges.
 */
export function waterOutlineAngleAt(x: number, z: number): number {
  return -Math.atan2(z, x);
}

// --- Opening camera framing --------------------------------------------------
// Six passes of shape, scale, palette and wave work did not stop the lake
// reading as a puddle, and the measurable reason is the VIEWPOINT, not the
// water. The opening camera stood at the backend's rolled distance of 14-20
// units with its height at 0.42x that, aimed at the origin — which is INSIDE
// the lake's own outer radius (16-22 for the same clearing range), six to eight
// units above the surface. The bottom edge of a 50-degree frame then lands on
// open water at ~0.62x the camera distance, so the near bank is cropped away
// entirely and the far bank sits in the middle distance beneath a tall band of
// forest. Water seen from above with no near bank has no depth gradient and no
// scale reference, and the forest above it wins the frame: that is a puddle
// read, however good the surface is. Pulling further back only shrinks the lake.
//
// Every reference photograph of a forest lake is instead taken FROM THE BANK: a
// few metres of shore in the foreground, the water receding at a grazing angle,
// the far shore and treeline compressed toward the horizon. Perspective does the
// work that no amount of shoreline detail could. Grazing incidence also buys
// real reflection for free — Fresnel is ~30% at 80 degrees against ~2% looking
// straight down, which is why the surface never showed the sky before.
//
// Limit worth knowing: only the central sight line is guaranteed clear of
// trunks (the camera stands inside the tree-free bank, so every point between it
// and the water is inside that band too). Rays that leave the axis can cross a
// bay that recedes further than the bank, and a shore tree may stand in front of
// that water. Closing that off would need a tree-free band as wide as the
// deepest bay, which would cost most of the forest.

/** Eye height above whatever ground the camera stands on. */
const SHORE_CAMERA_EYE_HEIGHT = 1.7;
/**
 * Where the near waterline should sit in the frame, as a fraction of frame
 * height up from the bottom edge. Small on purpose: the bank is the foreground,
 * not the subject.
 */
const SHORE_CAMERA_WATERLINE_FRAME_FRACTION = 0.12;
/**
 * Standoff and look-down angle each depend on the other, so the standoff is
 * SOLVED rather than tuned: a constant that frames the waterline correctly at
 * one clearing radius misses it at the rest of the range. The iteration
 * contracts (the standoff only enters through atan(height / distance), which is
 * flat here), and six passes settle it to well under a millimetre.
 */
const SHORE_CAMERA_STANDOFF_SOLVER_PASSES = 6;
/** Stay this far inside the tree-free bank, so no trunk shares the camera's spot. */
const SHORE_CAMERA_TREE_CLEARANCE = 0.5;
const MINIMUM_SHORE_CAMERA_STANDOFF = 1.5;
/**
 * How far the sight line to the far shore must pass above the near bank's crest.
 * A grazing view is extremely sensitive to this: measured across the backend's
 * terrain ranges, a fixed eye height hid up to 10.5 units of the far water —
 * effectively the whole far half of the lake — behind a bank crest less than a
 * unit high. So the eye RISES until it sees over its own bank. The margin also
 * buys clearance over the grass tufts (0.45-0.65 tall) that grow to the
 * waterline; a few blades across the foreground is framing, a wall of them is
 * not.
 */
const SHORE_CAMERA_CREST_CLEARANCE = 0.5;
const SHORE_CAMERA_CREST_SAMPLES = 24;
const DEGREES_TO_RADIANS = Math.PI / 180;

export type ForestCameraFraming = {
  /** Horizontal distance from the scene centre. The camera stands on +Z. */
  distance: number;
  /** Height above the water plane (y = 0), not above the local ground. */
  height: number;
};

/**
 * Shoreline radius on the +Z axis, where the opening camera stands. The MEAN
 * radius is the wrong number here: the outline swings from 0.3x to 1.48x of it,
 * so a camera placed against the mean stands in the water on any seed whose
 * bank happens to bulge along +Z.
 */
export function lakeShoreRadiusOnOpeningAxis(terrain?: ForestTerrainConfig): number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  return lakeRadiusFromTerrain(terrain) * outline.radiusFactorAt(waterOutlineAngleAt(0, 1));
}

/** Shoreline radius on the -Z axis: the far bank the opening shot looks across. */
export function lakeShoreRadiusAcrossOpeningAxis(terrain?: ForestTerrainConfig): number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  return lakeRadiusFromTerrain(terrain) * outline.radiusFactorAt(waterOutlineAngleAt(0, -1));
}

/**
 * Places the opening camera on the lake's near bank, aimed at the scene centre,
 * with the waterline just inside the bottom of the frame. Derived from the lake
 * the renderer actually builds — the backend's rolled `camera.distance` predates
 * the lake and knows nothing about its extent, so for forests it is ignored.
 */
export function forestShoreCameraFraming(
  terrain: ForestTerrainConfig | undefined,
  fieldOfViewDegrees: number
): ForestCameraFraming {
  const shoreRadius = lakeShoreRadiusOnOpeningAxis(terrain);
  const farShoreRadius = lakeShoreRadiusAcrossOpeningAxis(terrain);
  const terrainHeightSampler = createTerrainHeightSampler(terrain);
  const halfFrameRadians = (fieldOfViewDegrees * DEGREES_TO_RADIANS) / 2;
  const waterlineInsetRadians = 2 * halfFrameRadians * SHORE_CAMERA_WATERLINE_FRAME_FRACTION;
  const maximumStandoff = Math.max(
    MINIMUM_SHORE_CAMERA_STANDOFF,
    LAKE_SHORE_PLANTING_BUFFER - SHORE_CAMERA_TREE_CLEARANCE
  );
  // Two constraints, whichever is higher. Standing height: the bank can dip below
  // the water plane a few units back from the shore, so the eye is measured from
  // the ground but floored at the water — a camera under y = 0 would look up
  // through the surface from beneath. Sight line: the ray to the far shore has to
  // clear the near bank's crest, and only the bank can hide the lake (everything
  // past the waterline is bed or island, and an island is meant to be seen).
  const heightAt = (distance: number) => {
    let requiredHeight = Math.max(0, terrainHeightSampler(0, distance)) + SHORE_CAMERA_EYE_HEIGHT;
    const totalRun = distance + farShoreRadius;
    const standoff = distance - shoreRadius;
    for (let sample = 1; sample <= SHORE_CAMERA_CREST_SAMPLES; sample += 1) {
      const run = (standoff * sample) / SHORE_CAMERA_CREST_SAMPLES;
      const crestHeight = terrainHeightSampler(0, distance - run) + SHORE_CAMERA_CREST_CLEARANCE;
      // Ray height at this point is cameraHeight * (1 - run / totalRun).
      requiredHeight = Math.max(requiredHeight, crestHeight / (1 - run / totalRun));
    }
    return requiredHeight;
  };

  let standoff = maximumStandoff;
  for (let pass = 0; pass < SHORE_CAMERA_STANDOFF_SOLVER_PASSES; pass += 1) {
    const distance = shoreRadius + standoff;
    const height = heightAt(distance);
    const waterlineDepressionRadians = Math.atan(height / distance) + halfFrameRadians - waterlineInsetRadians;
    standoff = clampValue(
      height / Math.tan(waterlineDepressionRadians),
      MINIMUM_SHORE_CAMERA_STANDOFF,
      maximumStandoff
    );
  }
  const distance = shoreRadius + standoff;
  return { distance, height: heightAt(distance) };
}

export type RiverShape = {
  headingRadians: number;
  meanderPhase: number;
  /** Half length of the channel: it runs -spanRadius..+spanRadius through the lake. */
  spanRadius: number;
};

export function createRiverShape(terrain?: ForestTerrainConfig): RiverShape {
  const nextRandomValue = randomFromSeed((terrain?.placementSeed ?? "forest-terrain") + RIVER_SHAPE_SEED_SUFFIX);
  return {
    headingRadians: nextRandomValue() * FULL_CIRCLE_RADIANS,
    meanderPhase: nextRandomValue() * FULL_CIRCLE_RADIANS,
    spanRadius: treelineRadiusFromTerrain(terrain) * RIVER_SPAN_FRACTION_OF_TREELINE
  };
}

/** Signed lateral meander offset of the centreline at `along` metres from the lake. */
export function riverMeanderOffsetAt(shape: RiverShape, along: number): number {
  return (
    Math.sin((along / RIVER_MEANDER_WAVELENGTH) * FULL_CIRCLE_RADIANS + shape.meanderPhase) * RIVER_MEANDER_AMPLITUDE
  );
}

/** World-space centreline point at `along` metres from the lake. */
export function riverCenterlineAt(shape: RiverShape, along: number): { x: number; z: number } {
  const lateral = riverMeanderOffsetAt(shape, along);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);
  return {
    x: directionX * along - directionZ * lateral,
    z: directionZ * along + directionX * lateral
  };
}

/**
 * Half width at `along`. The channel widens slightly as it nears the lake, the
 * way a real outflow does, but it no longer flares to lake width: the river is
 * now drawn only OUTSIDE the shoreline, so a flare would just be a wedge lying
 * on top of the water.
 */
export function riverHalfWidthAt(along: number, lakeExitDistance: number): number {
  const distanceBeyondShore = Math.max(0, Math.abs(along) - lakeExitDistance);
  const mouthWidening = Math.exp(-((distanceBeyondShore / 6) ** 2)) * RIVER_HALF_WIDTH * 0.6;
  return RIVER_HALF_WIDTH + mouthWidening;
}

/**
 * Where the channel leaves the lake, per side. Measured from the outline at the
 * river's own heading rather than from the mean radius, so the mouth lands on
 * the shore even where the lake bulges out.
 */
export function riverLakeExitDistance(shape: RiverShape, terrain?: ForestTerrainConfig): number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  const meanRadius = lakeRadiusFromTerrain(terrain);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);
  // Sample both ends of the channel and take the wider one, so neither mouth can
  // start inside the water.
  const forwardFactor = outline.radiusFactorAt(waterOutlineAngleAt(directionX, directionZ));
  const backwardFactor = outline.radiusFactorAt(waterOutlineAngleAt(-directionX, -directionZ));
  return meanRadius * Math.max(forwardFactor, backwardFactor);
}

/**
 * Distance from a point to the WATER EDGE of the river (0 inside the channel),
 * so scatter code can reuse the same "is this too close?" threshold it already
 * applies to the dirt path. Composed with the path sampler in ForestRenderer:
 * anything the water covers must not also grow a tree.
 */
export function createRiverEdgeDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  const shape = createRiverShape(terrain);
  const lakeExitDistance = riverLakeExitDistance(shape, terrain);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);

  return (x: number, z: number) => {
    // Project onto the channel's axis. The meander is shallow enough that the
    // axis-aligned projection is an accurate stand-in for a true curve
    // distance, and it stays analytic (no polyline walk per query).
    const along = x * directionX + z * directionZ;
    if (Math.abs(along) > shape.spanRadius) {
      return Number.POSITIVE_INFINITY;
    }
    const perpendicular = -x * directionZ + z * directionX;
    const lateralDistance = Math.abs(perpendicular - riverMeanderOffsetAt(shape, along));
    return Math.max(0, lateralDistance - riverHalfWidthAt(along, lakeExitDistance));
  };
}

// A perfect circle never reads as a lake — a real shoreline is lobed and
// uneven. These build the outline as a seeded sum of sine harmonics at INTEGER
// frequencies, which is what makes the loop close exactly at theta = 2*PI (a
// non-integer harmonic leaves a visible notch at the seam). Everything stays at
// a single Y, so the surface is still planar and MeshReflectorMaterial remains
// valid — that planarity is the whole reason the lake sits on flat ground.
// Frequency 2 carries most of the amplitude ON PURPOSE: it is the elongation
// term, and an elongated basin is most of what separates "lake" from "puddle".
// A roughly round outline reads as a puddle at any size, because puddles are
// round and lakes lie along a valley. The higher harmonics only add inlets and
// headlands on top of that long axis.
// The top harmonics (17, 23) are GONE. Chasing shoreline development index alone
// pushed them up, SDI reached 1.58 — and the result read as a jagged splat rather
// than a lake, because real shorelines are SMOOTH curves with a few large bays,
// not high-frequency crenellation. That was the metric being gamed: SDI counts
// perimeter and cannot tell a big sweeping bay from a row of small notches.
// Keeping the low harmonics and the bay gain buys the same character at a
// slightly lower score, which is the right trade.
const WATER_OUTLINE_HARMONIC_FREQUENCIES = [2, 3, 5, 7, 11];
const WATER_OUTLINE_HARMONIC_AMPLITUDES = [0.24, 0.088, 0.07, 0.05, 0.032];
const WATER_OUTLINE_SEGMENTS = 192;
/**
 * Inward excursions are amplified; outward ones are not. Bays cut in, headlands
 * stay put — so the shoreline gets far more convoluted WITHOUT growing the
 * maximum radius, which is what bounds the tree band.
 *
 * Measured by shoreline development index (perimeter over the perimeter of a
 * circle of equal area — the standard limnological measure; 1.00 is a perfect
 * circle, real lakes run 1.5-3.0). The eight-harmonic figures this comment used
 * to quote were from a configuration that no longer ships; what ships now scores
 * 1.155 to 1.197 across 4000 seeds, and the numbers come from
 * forestFidelityMetrics.test.ts rather than from a hand measurement that can go
 * stale the way those did.
 *
 * Raising amplitudes instead of gaining the bays reaches a higher index and costs
 * tree band, because it grows the headlands as well as the bays.
 */
const WATER_OUTLINE_BAY_DEPTH_GAIN = 2.0;
const MINIMUM_WATER_OUTLINE_FACTOR = 0.3;
/** Width of the smooth bay/headland crossover. Larger = rounder transitions. */
const WATER_OUTLINE_BAY_TRANSITION_SOFTNESS = 0.11;

export type WaterOutline = {
  /** Radius multiplier at an angle; averages ~1 so `radius` stays the mean. */
  radiusFactorAt: (angleRadians: number) => number;
  segments: number;
};

export function createWaterOutline(seedText: string): WaterOutline {
  const nextRandomValue = randomFromSeed(seedText + "-water-outline");
  const harmonics = WATER_OUTLINE_HARMONIC_FREQUENCIES.map((frequency, harmonicIndex) => ({
    frequency,
    phase: nextRandomValue() * FULL_CIRCLE_RADIANS,
    amplitude: WATER_OUTLINE_HARMONIC_AMPLITUDES[harmonicIndex]
  }));
  return {
    segments: WATER_OUTLINE_SEGMENTS,
    radiusFactorAt: (angleRadians: number) => {
      let excursion = 0;
      for (const harmonic of harmonics) {
        excursion += Math.sin(harmonic.frequency * angleRadians + harmonic.phase) * harmonic.amplitude;
      }
      // Deepen bays without putting a CORNER at every bay-to-headland
      // transition. Branching on the sign of the excursion looks harmless but
      // steps the derivative from the gain straight down to 1 at each crossing,
      // and a shoreline with a kink at every transition is exactly the angular
      // "splat" this was meant to cure. Weighting the gain with a smooth sigmoid
      // keeps the curve C1 everywhere while still leaving headlands untouched.
      const bayWeight = 1 / (1 + Math.exp(excursion / WATER_OUTLINE_BAY_TRANSITION_SOFTNESS));
      const gained = excursion * (1 + (WATER_OUTLINE_BAY_DEPTH_GAIN - 1) * bayWeight);
      // Bays approach the floor asymptotically instead of being clipped to it: a
      // hard Math.max leaves flat-bottomed bays joined by sharp corners. Linear
      // near zero, so shallow bays are unaffected, and C1 at the join.
      const availableDepth = 1 - MINIMUM_WATER_OUTLINE_FACTOR;
      return (
        1 + (gained >= 0 ? gained : -availableDepth * (1 - Math.exp(gained / availableDepth)))
      );
    }
  };
}

/** Largest radius the outline reaches — what neighbours must stay clear of. */
export function maximumOutlineRadiusFactor(): number {
  return 1 + WATER_OUTLINE_HARMONIC_AMPLITUDES.reduce((sum, amplitude) => sum + amplitude, 0);
}

export function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstepValue(edgeStart: number, edgeEnd: number, value: number): number {
  const t = clampValue((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Mix two hex colors into a fresh THREE.Color (t=0 → colorA). */
export function mixHexColors(colorA: string, colorB: string, t: number): Color {
  return new Color(colorA).lerp(new Color(colorB), clampValue(t, 0, 1));
}

export function clearingRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return terrain?.clearingRadius ?? DEFAULT_CLEARING_RADIUS;
}

export function treelineRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return terrain?.treelineRadius ?? DEFAULT_TREELINE_RADIUS;
}

export type TerrainHeightSampler = (x: number, z: number) => number;

/**
 * Analytic rolling-hill height field: two crossed sine bands plus a diagonal
 * swell, with seeded phases so every forest rolls differently. Analytic (not
 * noise-array) so trees, animals, landmarks and the ground mesh can all sample
 * the exact same surface at any coordinate.
 */
export function createTerrainHeightSampler(terrain?: ForestTerrainConfig): TerrainHeightSampler {
  const nextRandomValue = randomFromSeed((terrain?.placementSeed ?? "forest-terrain") + HILL_SHAPE_SEED_SUFFIX);
  const phaseA = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const phaseB = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const phaseC = nextRandomValue() * FULL_CIRCLE_RADIANS;

  const hillAmplitude = terrain?.hillAmplitude ?? DEFAULT_HILL_AMPLITUDE;
  const hillFrequency = terrain?.hillFrequency ?? DEFAULT_HILL_FREQUENCY;
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const angularFrequency = hillFrequency * FULL_CIRCLE_RADIANS;
  const signedLakeEdgeDistanceSampler = createLakeSignedEdgeDistanceSampler(terrain);
  const lakeIslands = createLakeIslands(terrain, createWaterOutline(lakeShapeSeedFromTerrain(terrain)));

  return (x: number, z: number) => {
    const radiusFromCenter = Math.hypot(x, z);
    const clearingFlattenFactor = smoothstepValue(
      clearingRadius * CLEARING_FLATTEN_INNER_FRACTION,
      clearingRadius * CLEARING_FLATTEN_OUTER_FRACTION,
      radiusFromCenter
    );
    const crossedBands =
      Math.sin(x * angularFrequency + phaseA) * Math.cos(z * angularFrequency * 1.7 + phaseB) * 0.65;
    const diagonalSwell = Math.sin((x + z) * angularFrequency * 0.5 + phaseC) * 0.35;
    const rollingHills = hillAmplitude * (crossedBands + diagonalSwell) * clearingFlattenFactor;

    // Carve the lake basin. Without this the ground keeps rolling under a planar
    // water surface and hilltops poke through the middle of the lake — which is
    // the whole reason the lake could not simply be made bigger.
    //
    // The carve is built around the SIGNED shore distance so the surface passes
    // through exactly zero at the waterline: it shelves down to LAKE_BED_DEPTH
    // going inward, and climbs back to the natural hills going outward. Driving
    // it from a clamped distance instead leaves the bed flat all the way to the
    // edge, and then the water plane sits on top of a wall as deep as the lake.
    const signedShoreDistance = signedLakeEdgeDistanceSampler(x, z);
    let nearHills =
      signedShoreDistance >= 0
        ? rollingHills * smoothstepValue(0, LAKE_SHORE_BLEND_WIDTH, signedShoreDistance)
        : -LAKE_BED_DEPTH * smoothstepValue(0, LAKE_BED_SHELF_WIDTH, -signedShoreDistance);

    // Islands rise back out of the carved bed. Taken as a MAXIMUM rather than
    // added, so an islet keeps its shape instead of inheriting the bed's slope.
    for (const island of lakeIslands) {
      const distanceFromIsland = Math.hypot(x - island.x, z - island.z);
      if (distanceFromIsland >= island.radius) {
        continue;
      }
      const dome = smoothstepValue(island.radius, island.radius * 0.35, distanceFromIsland);
      nearHills = Math.max(nearHills, LAKE_ISLAND_PEAK_HEIGHT * dome - LAKE_BED_DEPTH * (1 - dome));
    }

    // Distant forested hills: ramp up past the treeline so the far horizon is
    // a rolling ridgeline, not the cut edge of a flat slab.
    const distantRise = smoothstepValue(
      treelineRadius * DISTANT_RISE_INNER_FRACTION,
      treelineRadius * DISTANT_RISE_OUTER_FRACTION,
      radiusFromCenter
    );
    if (distantRise <= 0) {
      return nearHills;
    }
    const distantAngularFrequency = DISTANT_HILL_FREQUENCY;
    const distantUndulation =
      (Math.sin(x * distantAngularFrequency + phaseB * 1.7) * Math.cos(z * distantAngularFrequency * 1.3 + phaseC) * 0.5 +
        0.5) *
      DISTANT_HILL_UNDULATION;
    const distantHills = (DISTANT_HILL_BASE_RISE + distantUndulation) * Math.pow(distantRise, 1.4);
    return nearHills + distantHills;
  };
}

export type PathLateralDistanceSampler = (x: number, z: number) => number;

/**
 * Lateral distance (in world units) from a point to the dirt path's seeded
 * centerline. Returns Infinity when the config has no path, so callers can
 * use one code path ("is this inside the path band?") either way.
 */
export function createPathLateralDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  if (!terrain?.pathEnabled) {
    return () => Number.POSITIVE_INFINITY;
  }
  const nextRandomValue = randomFromSeed((terrain.placementSeed ?? "forest-terrain") + PATH_SHAPE_SEED_SUFFIX);
  const pathBaseAngle = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const curvePhase = nextRandomValue() * PATH_CURVE_PHASE_RANGE_RADIANS;
  const curveAmplitude = MINIMUM_PATH_CURVE_AMPLITUDE_RADIANS + nextRandomValue() * PATH_CURVE_AMPLITUDE_RANGE_RADIANS;

  return (x: number, z: number) => {
    const radiusFromCenter = Math.hypot(x, z);
    if (radiusFromCenter < 0.001) {
      return Number.POSITIVE_INFINITY;
    }
    const pointAngle = Math.atan2(z, x);
    const pathAngleAtRadius = pathBaseAngle + Math.sin(radiusFromCenter * PATH_CURVE_RADIAL_FREQUENCY + curvePhase) * curveAmplitude;
    let angularDifference = pointAngle - pathAngleAtRadius;
    while (angularDifference > Math.PI) {
      angularDifference -= FULL_CIRCLE_RADIANS;
    }
    while (angularDifference < -Math.PI) {
      angularDifference += FULL_CIRCLE_RADIANS;
    }
    return Math.abs(angularDifference) * radiusFromCenter;
  };
}

// --- Season blending ---------------------------------------------------------

const GROUND_BASE_COLORS_BY_KIND: Record<string, string> = {
  grass: "#4E7D3C",
  leafLitter: "#8A6134",
  snow: "#E9EFF4"
};

const GROUND_KINDS_BY_SEASON_KIND: Record<string, string> = {
  spring: "grass",
  summer: "grass",
  autumn: "leafLitter",
  winter: "snow"
};

const DEFAULT_GROUND_COLOR = GROUND_BASE_COLORS_BY_KIND.grass;

// How much of the blend amount actually shifts the ground color — a full lerp
// at blendAmount 0.6 would read as the wrong season, not a transition.
const GROUND_BLEND_STRENGTH = 0.6;

/**
 * The renderer half of the "giao mùa" contract: the ground color leans toward
 * the adjacent season's ground by blendAmount (schema: "the renderer lerps
 * tint, ground and particle counts toward the adjacent season").
 */
export function blendedGroundColor(season?: ForestSeasonConfig): Color {
  const baseColor = GROUND_BASE_COLORS_BY_KIND[season?.groundKind ?? "grass"] ?? DEFAULT_GROUND_COLOR;
  const blendTowardKind = season?.blendTowardKind;
  const blendAmount = season?.blendAmount ?? 0;
  if (!blendTowardKind || blendAmount <= 0) {
    return new Color(baseColor);
  }
  const towardGroundKind = GROUND_KINDS_BY_SEASON_KIND[blendTowardKind] ?? "grass";
  const towardColor = GROUND_BASE_COLORS_BY_KIND[towardGroundKind] ?? DEFAULT_GROUND_COLOR;
  return mixHexColors(baseColor, towardColor, blendAmount * GROUND_BLEND_STRENGTH);
}

const FALLBACK_FOLIAGE_COLORS = ["#4F9149", "#6FAF5D", "#89C97C"];

// Foliage anchor per adjacent season for the transition tint (one
// representative color is enough — the full palette still comes from the
// primary season).
const FOLIAGE_ANCHOR_COLORS_BY_SEASON_KIND: Record<string, string> = {
  spring: "#89C97C",
  summer: "#4F9149",
  autumn: "#D98E2B",
  winter: "#DDE7EC"
};

const FOLIAGE_BLEND_STRENGTH = 0.5;

/** Foliage palette with the transitional-season tint already applied. */
export function blendedFoliageColors(season?: ForestSeasonConfig): Color[] {
  const paletteHexColors =
    season?.foliageColors && season.foliageColors.length > 0 ? season.foliageColors : FALLBACK_FOLIAGE_COLORS;
  const blendTowardKind = season?.blendTowardKind;
  const blendAmount = season?.blendAmount ?? 0;
  if (!blendTowardKind || blendAmount <= 0) {
    return paletteHexColors.map((hexColor) => new Color(hexColor));
  }
  const anchorColor = FOLIAGE_ANCHOR_COLORS_BY_SEASON_KIND[blendTowardKind] ?? FALLBACK_FOLIAGE_COLORS[0];
  return paletteHexColors.map((hexColor) => mixHexColors(hexColor, anchorColor, blendAmount * FOLIAGE_BLEND_STRENGTH));
}
