import { randomFromSeed } from "@/lib/scene";
import type { OceanSeafloorConfig } from "@/lib/types";
import { significantWaveHeightMetres } from "./oceanSeaState";
import { BLUE_SEA_YAW_OFFSET_RADIANS } from "./oceanSky";

/**
 * Deterministic maths for the ocean renderer.
 *
 * Everything scattered, swum or drifted here comes from a seed embedded in the
 * config by ocean-service. Math.random() is banned in scene code for exactly
 * this reason: a world has to render the same way tomorrow, on someone else's
 * machine, from the same seed.
 */

export type SeafloorHeightSampler = (x: number, z: number) => number;

const DEFAULT_BASIN_RADIUS = 30;
const DEFAULT_RIDGE_AMPLITUDE = 2.2;
const DEFAULT_RIDGE_FREQUENCY = 0.045;

// A second, finer octave at these ratios turns a single smooth swell into
// something that reads as rock rather than as a bedsheet.
const SECOND_OCTAVE_FREQUENCY_MULTIPLIER = 2.7;
const SECOND_OCTAVE_AMPLITUDE_MULTIPLIER = 0.38;

// The basin dishes downward toward its rim so the floor does not simply end at
// a cliff where the geometry runs out.
const BASIN_RIM_DROP = 3.5;

export function basinRadiusFromSeafloor(seafloor?: OceanSeafloorConfig): number {
  return seafloor?.basinRadius ?? DEFAULT_BASIN_RADIUS;
}

/**
 * The seafloor's height at a point. Two sine octaves plus a rim dish — the
 * ocean counterpart of the forest's hill sampler, and like it, a pure function
 * so terrain, flora, rocks and fish all agree about where the floor is without
 * sharing state.
 */
export function createSeafloorHeightSampler(seafloor?: OceanSeafloorConfig): SeafloorHeightSampler {
  const amplitude = seafloor?.ridgeAmplitude ?? DEFAULT_RIDGE_AMPLITUDE;
  const frequency = seafloor?.ridgeFrequency ?? DEFAULT_RIDGE_FREQUENCY;
  const basinRadius = basinRadiusFromSeafloor(seafloor);
  return (x: number, z: number) => {
    const primary = Math.sin(x * frequency * Math.PI) * Math.cos(z * frequency * Math.PI);
    const secondary =
      Math.sin(x * frequency * SECOND_OCTAVE_FREQUENCY_MULTIPLIER * Math.PI + 1.7) *
      Math.cos(z * frequency * SECOND_OCTAVE_FREQUENCY_MULTIPLIER * Math.PI - 0.9) *
      SECOND_OCTAVE_AMPLITUDE_MULTIPLIER;
    const radial = Math.min(1, Math.hypot(x, z) / Math.max(1, basinRadius));
    return (primary + secondary) * amplitude - radial * radial * BASIN_RIM_DROP;
  };
}

// How many points around the rim of a footprint are sampled when there is no
// mesh to sample instead. Eight is where the gap this closes stops narrowing:
// the seabed's shortest wavelength is the wind ripple at about 11 m and a
// footprint is a few metres across, so the surface under one object is close to
// a plane, and a ring of eight finds its low corner.
const FOOTPRINT_RIM_SAMPLE_COUNT = 8;
// The most mesh vertices this will look at along one axis, whatever the
// footprint and cell size ask for. A guard against a pathological call, not a
// quality setting: the real cases need three or four.
const MAXIMUM_FOOTPRINT_SAMPLES_PER_AXIS = 12;

/**
 * The LOWEST the DRAWN seabed gets anywhere under a footprint of this radius.
 *
 * Two things put a landmark in the air, and this answers both.
 *
 * The foot is a footprint, not a point, and it used to be placed against a
 * single sample taken at its centre. The seabed carries 1.2 m dunes over an
 * 18 m wavelength, so a shape five metres across standing on a slope has its
 * uphill edge buried and its downhill edge in open water however correct its
 * centre is.
 *
 * And `heightSampler` is the height FUNCTION, while what the eye sees is that
 * function sampled on a grid and joined with flat triangles. Those triangles
 * cut every corner, so the drawn floor hangs BELOW the function — by about
 * 0.2 m at desktop's 2.27 m vertex spacing and 0.6 m at mobile's 5.67 m. An
 * object placed on the function is that far above the sand it appears to
 * stand on, and it is worse on the weaker device, which is the opposite of
 * how a quality setting should fail.
 *
 * So when the mesh spacing is known the samples are taken AT ITS VERTICES,
 * across every cell the footprint touches. Their minimum is at or below the
 * drawn surface everywhere inside the footprint, because a triangle never dips
 * below its own corners — which makes this exact rather than an estimate. With
 * no mesh (`meshCellSizeMetres` of 0, the first frames before the rig exists)
 * it falls back to a ring on the function itself.
 *
 * The minimum is the right end of the range and not the mean: an object half a
 * metre into the seabed reads as settled, and the same object half a metre
 * above it reads as broken.
 */
export function lowestSeafloorUnderFootprint(
  heightSampler: SeafloorHeightSampler,
  centreX: number,
  centreZ: number,
  footprintRadiusMetres: number,
  meshCellSizeMetres: number
): number {
  let lowest = heightSampler(centreX, centreZ);
  if (!(footprintRadiusMetres > 0)) {
    return lowest;
  }

  if (!(meshCellSizeMetres > 0)) {
    for (let sampleIndex = 0; sampleIndex < FOOTPRINT_RIM_SAMPLE_COUNT; sampleIndex += 1) {
      const angle = (sampleIndex / FOOTPRINT_RIM_SAMPLE_COUNT) * Math.PI * 2;
      const sampled = heightSampler(
        centreX + Math.cos(angle) * footprintRadiusMetres,
        centreZ + Math.sin(angle) * footprintRadiusMetres
      );
      if (sampled < lowest) {
        lowest = sampled;
      }
    }
    return lowest;
  }

  // Every vertex of every cell the footprint overlaps, so the whole triangle
  // fan under the shape is accounted for and not just the part inside the
  // circle.
  const firstColumn = Math.floor((centreX - footprintRadiusMetres) / meshCellSizeMetres);
  const lastColumn = Math.ceil((centreX + footprintRadiusMetres) / meshCellSizeMetres);
  const firstRow = Math.floor((centreZ - footprintRadiusMetres) / meshCellSizeMetres);
  const lastRow = Math.ceil((centreZ + footprintRadiusMetres) / meshCellSizeMetres);
  const columnCount = Math.min(MAXIMUM_FOOTPRINT_SAMPLES_PER_AXIS, lastColumn - firstColumn + 1);
  const rowCount = Math.min(MAXIMUM_FOOTPRINT_SAMPLES_PER_AXIS, lastRow - firstRow + 1);
  for (let column = 0; column < columnCount; column += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      const sampled = heightSampler(
        (firstColumn + column) * meshCellSizeMetres,
        (firstRow + row) * meshCellSizeMetres
      );
      if (sampled < lowest) {
        lowest = sampled;
      }
    }
  }
  return lowest;
}

/**
 * The lowest the seafloor gets, for anything that needs to know where the world
 * bottoms out — the graded water backdrop anchors its dark end here.
 *
 * Derived from the sampler's own terms rather than sampled: both octaves reach
 * -1 together somewhere, and the rim dish is at its full drop at the basin edge.
 * That makes this an exact lower bound instead of whatever a sample grid found,
 * which matters because a gradient anchored above the actual floor puts a
 * visible bright band under the terrain.
 */
export function seafloorLowestPoint(seafloor?: OceanSeafloorConfig): number {
  const amplitude = seafloor?.ridgeAmplitude ?? DEFAULT_RIDGE_AMPLITUDE;
  return -(amplitude * (1 + SECOND_OCTAVE_AMPLITUDE_MULTIPLIER) + BASIN_RIM_DROP);
}

// Scene units per metre of real depth, for placing the surface overhead. A reef
// at 17 m puts the surface 17 units up — dominant, right where it belongs, in a
// basin about 30 units across. Deeper worlds clamp: past the maximum the surface
// is far enough to be a glow rather than a plane, and the depth curve's light
// fraction has faded it out anyway.
const SCENE_UNITS_PER_METRE = 1;
const SURFACE_MAX_SCENE_HEIGHT = 95;
const SURFACE_MIN_SCENE_HEIGHT = 9;

/**
 * How far above the viewer to place the ocean surface, in scene units.
 *
 * Lives here rather than in the component that draws the surface because the
 * light shafts need the same number: a shaft that fades out at a different
 * height than the surface it supposedly comes through is the fastest way to
 * make the two read as unrelated effects layered on the same frame.
 */
export function surfaceSceneHeight(viewerMetres: number): number {
  return Math.min(
    SURFACE_MAX_SCENE_HEIGHT,
    Math.max(SURFACE_MIN_SCENE_HEIGHT, viewerMetres * SCENE_UNITS_PER_METRE)
  );
}

export type ReefCluster = {
  x: number;
  z: number;
  /** How far the cluster's members spread from its centre. */
  radius: number;
};

/**
 * Where the reef actually is.
 *
 * A seabed scattered uniformly over a disc is the single most reliable way to
 * make an ecosystem look procedurally generated, and it is what this family
 * shipped: every plant equally far from every other plant, no thickets, no bare
 * sand, nothing for the eye to rest on or travel between. Real seabeds are the
 * opposite — life gathers where there is shelter and hard substrate, and the
 * ground between two thickets is nearly empty.
 *
 * Cluster radii vary widely on purpose. A few large loose beds and several
 * tight small ones give the composition a range of grain, which is what lets a
 * viewer read distance from density alone.
 */
export function createReefClusters(seed: string, count: number, basinRadius: number): ReefCluster[] {
  const nextRandomValue = randomFromSeed(seed);
  return Array.from({ length: count }, () => {
    const angle = nextRandomValue() * Math.PI * 2;
    // sqrt keeps the centres area-uniform; 0.82 holds them inside the basin so
    // a cluster's outer members do not spill past the floor's own edge.
    const radial = Math.sqrt(nextRandomValue()) * basinRadius * 0.82;
    return {
      x: Math.cos(angle) * radial,
      z: Math.sin(angle) * radial,
      radius: basinRadius * (0.07 + nextRandomValue() * 0.22)
    };
  });
}

/**
 * Places one member inside a cluster from the two draws that used to place it
 * on the open disc.
 *
 * Takes the SAME two rolls the uniform scatter took, in the same order, and
 * spends them differently: the angle roll picks the cluster and then doubles as
 * the bearing within it, the radial roll becomes the distance from that
 * cluster's centre. No new draw is added and no stream changes hands, so every
 * other seeded decision in the scene lands exactly where it did before — only
 * the positions move, which is the entire point.
 */
export function placeInCluster(
  clusters: ReefCluster[],
  angleRoll: number,
  radialRoll: number
): { x: number; z: number } {
  if (clusters.length === 0) {
    return { x: 0, z: 0 };
  }
  const scaled = angleRoll * clusters.length;
  const cluster = clusters[Math.min(clusters.length - 1, Math.floor(scaled))];
  const localAngle = (scaled - Math.floor(scaled)) * Math.PI * 2;
  const localRadius = Math.sqrt(radialRoll) * cluster.radius;
  return {
    x: cluster.x + Math.cos(localAngle) * localRadius,
    z: cluster.z + Math.sin(localAngle) * localRadius
  };
}

export type ScatterPoint = {
  x: number;
  z: number;
  /** 0..1, for per-instance scale/rotation variation. */
  variation: number;
  yawRadians: number;
};

/**
 * Scatters `count` points across a disc of `radius`, deterministically.
 *
 * sqrt on the radial roll is what keeps the density even: without it every
 * point crowds the centre, because a disc's area grows with r squared.
 */
export function scatterOnDisc(seed: string, count: number, radius: number, innerRadius = 0): ScatterPoint[] {
  const nextRandomValue = randomFromSeed(seed);
  const points: ScatterPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = nextRandomValue() * Math.PI * 2;
    const radial = Math.sqrt(nextRandomValue());
    const variation = nextRandomValue();
    const yawRadians = nextRandomValue() * Math.PI * 2;
    const distance = innerRadius + radial * (radius - innerRadius);
    points.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, variation, yawRadians });
  }
  return points;
}

export type SchoolPath = {
  /** Centre of the loop the school swims. */
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  /** Height above the seafloor the school holds. */
  heightAboveFloor: number;
  phase: number;
  /** Radians per second around the loop. */
  angularSpeed: number;
  /** Small vertical bob so a school does not read as a flat carousel. */
  bobAmplitude: number;
  bobSpeed: number;
};

const SCHOOL_LOOP_RADIUS_FRACTION_BASE = 0.35;
const SCHOOL_LOOP_RADIUS_FRACTION_RANGE = 0.4;
const SCHOOL_LOOP_ECCENTRICITY_RANGE = 0.45;
const SCHOOL_ANGULAR_SPEED_SCALE = 0.055;
const SCHOOL_BOB_AMPLITUDE_BASE = 0.4;
const SCHOOL_BOB_AMPLITUDE_RANGE = 0.9;
const SCHOOL_BOB_SPEED_BASE = 0.25;
const SCHOOL_BOB_SPEED_RANGE = 0.4;

/**
 * One school's loop, derived from its own pathSeed. Draw order is fixed so
 * adding a field later never moves an existing school.
 */
export function createSchoolPath(
  pathSeed: string,
  basinRadius: number,
  depthBandMin: number,
  depthBandMax: number,
  swimSpeed: number
): SchoolPath {
  const nextRandomValue = randomFromSeed(pathSeed);
  const centerAngle = nextRandomValue() * Math.PI * 2;
  const centerDistance = nextRandomValue() * basinRadius * 0.35;
  const radiusFraction = SCHOOL_LOOP_RADIUS_FRACTION_BASE + nextRandomValue() * SCHOOL_LOOP_RADIUS_FRACTION_RANGE;
  const eccentricity = 1 - nextRandomValue() * SCHOOL_LOOP_ECCENTRICITY_RANGE;
  const heightRoll = nextRandomValue();
  const phase = nextRandomValue() * Math.PI * 2;
  const direction = nextRandomValue() < 0.5 ? -1 : 1;
  const bobAmplitude = SCHOOL_BOB_AMPLITUDE_BASE + nextRandomValue() * SCHOOL_BOB_AMPLITUDE_RANGE;
  const bobSpeed = SCHOOL_BOB_SPEED_BASE + nextRandomValue() * SCHOOL_BOB_SPEED_RANGE;

  const loopRadius = basinRadius * radiusFraction;
  return {
    centerX: Math.cos(centerAngle) * centerDistance,
    centerZ: Math.sin(centerAngle) * centerDistance,
    radiusX: loopRadius,
    radiusZ: loopRadius * eccentricity,
    heightAboveFloor: depthBandMin + heightRoll * Math.max(0, depthBandMax - depthBandMin),
    phase,
    angularSpeed: direction * swimSpeed * SCHOOL_ANGULAR_SPEED_SCALE,
    bobAmplitude,
    bobSpeed
  };
}

export type SchoolMemberOffset = {
  /** Along-track offset in radians — spreads the school into a stream. */
  alongTrackRadians: number;
  lateralOffset: number;
  verticalOffset: number;
  /** Per-fish tail-beat phase, so a school does not flap in unison. */
  beatPhase: number;
  scale: number;
};

const MEMBER_SCALE_BASE = 0.78;
const MEMBER_SCALE_RANGE = 0.44;

/**
 * Per-fish offsets from the school's path.
 *
 * cohesion pulls the members together along and across the track; separation
 * pushes them apart. Both arrive from the config, which is what makes a school
 * move as one body instead of as N fish on parallel rails — and what makes two
 * schools in the same world look like different species of behaviour.
 */
export function createSchoolMemberOffsets(
  pathSeed: string,
  count: number,
  cohesion: number,
  separation: number
): SchoolMemberOffset[] {
  const nextRandomValue = randomFromSeed(`${pathSeed}-members`);
  const spreadRadians = (1 - cohesion) * 1.6 + separation * 0.5;
  const lateralSpread = separation * 3.4 + (1 - cohesion) * 1.2;
  const verticalSpread = separation * 1.8;
  const offsets: SchoolMemberOffset[] = [];
  for (let index = 0; index < count; index += 1) {
    offsets.push({
      alongTrackRadians: (nextRandomValue() - 0.5) * spreadRadians,
      lateralOffset: (nextRandomValue() - 0.5) * lateralSpread,
      verticalOffset: (nextRandomValue() - 0.5) * verticalSpread,
      beatPhase: nextRandomValue() * Math.PI * 2,
      scale: MEMBER_SCALE_BASE + nextRandomValue() * MEMBER_SCALE_RANGE
    });
  }
  return offsets;
}

/**
 * Blends two hex colours. Used to tint everything toward the water's own colour
 * by the config's tintStrength — the reason a red coral reads brown-grey at
 * depth without anyone authoring a brown.
 */
export function mixHexColors(fromHex: string, toHex: string, amount: number): string {
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  const clamped = Math.min(1, Math.max(0, amount));
  const channels = [0, 1, 2].map((channel) => Math.round(from[channel] + (to[channel] - from[channel]) * clamped));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  if (normalized.length !== 6) {
    return [255, 255, 255];
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

/**
 * A giant's pass: it enters at approachDistance, crosses in front of the
 * camera and leaves, then waits before coming round again.
 *
 * Returns null while the giant is off stage, which is the point — a giant that
 * is always visible is a prop, and the config's passDurationSeconds is how long
 * it gets to be a moment instead.
 */
export type GiantPassState = {
  x: number;
  z: number;
  headingRadians: number;
  /** 0 at the edges of the pass, 1 in the middle — drives the fade. */
  presence: number;
};

const GIANT_REST_MULTIPLIER = 1.8;

export function giantPassStateAt(
  passSeed: string,
  approachDistance: number,
  passDurationSeconds: number,
  elapsedSeconds: number
): GiantPassState | null {
  const nextRandomValue = randomFromSeed(passSeed);
  const crossingAngle = nextRandomValue() * Math.PI * 2;
  const startOffset = nextRandomValue();
  const cycleSeconds = passDurationSeconds * GIANT_REST_MULTIPLIER;
  const cycleProgress = ((elapsedSeconds / cycleSeconds + startOffset) % 1 + 1) % 1;
  const passProgress = cycleProgress / (1 / GIANT_REST_MULTIPLIER);
  if (passProgress > 1) {
    return null;
  }
  // Travels across the full diameter of the visible sphere, so it arrives out
  // of the fog on one side and leaves into it on the other.
  const travel = (passProgress - 0.5) * approachDistance * 2;
  const lateral = approachDistance * 0.85;
  const x = Math.cos(crossingAngle) * travel - Math.sin(crossingAngle) * lateral;
  const z = Math.sin(crossingAngle) * travel + Math.cos(crossingAngle) * lateral;
  const edgeFade = Math.sin(Math.PI * Math.min(1, Math.max(0, passProgress)));
  return { x, z, headingRadians: crossingAngle, presence: edgeFade };
}

/**
 * Where the camera stands in an ocean world.
 *
 * The shared framing puts the camera well above the target and points it down,
 * which is right for a solar system seen from outside and wrong for anything a
 * person is standing IN. In the sea it costs the two things this family exists
 * to show: underwater it aims at the sand instead of into the blue, and above
 * the waterline it aims past the horizon entirely, so the sky — the whole
 * reason to surface — occupies a strip at the top of the frame.
 *
 * The rig places the viewer at the origin and the water surface at
 * `depth.metres`, so a camera at a small height looking at the origin is a
 * LEVEL gaze, which is what a diver and a person on a boat both have.
 *
 * Same shape and same reasoning as `forestShoreCameraFraming`: the family that
 * knows what it built decides how it is framed, and nothing else changes.
 */
/**
 * Where the ocean's sun sits when the config does not say.
 *
 * ONE fallback with two consumers — the rig that draws the sun and the camera
 * that has to be pointed at it. They were two independent numbers, which is the
 * class of bug where the sky puts a sunset in one direction and the camera looks
 * at the empty half of the sky.
 *
 * It is now only a FALLBACK. The bearing is a real config field
 * (`lighting.surfaceAzimuthRadians`, schemaVersion 1.2) because a constant meant
 * every above-water world in the family put its sun in the same place — the one
 * authored parameter in the prototype study with no counterpart here, and the
 * prototype varied it per view for a reason.
 */
export const OCEAN_SUN_AZIMUTH_RADIANS = 0.5;

/** A boundary is in reach when it lies within about 1.5 sighting ranges. */
const BOUNDARY_SIGHT_MULTIPLIER = 1.5;

/**
 * The sun elevation above which an above-water world stops being golden hour.
 *
 * The family's above-water band runs 0.06-0.70 rad (3.4-40 degrees); its two
 * archetypes sit at the ends of it — "Glass Shallows" golden hour rolls around
 * 0.08 rad, "Surface Daylight" around 0.65 — so 0.3 rad (17 degrees) splits
 * them with wide margin on both sides rather than sitting near either one.
 */
export const HIGH_SUN_ELEVATION_THRESHOLD_RADIANS = 0.3;

/**
 * THE ORBIT RADIUS IS THE CONFIG'S, AND IT MUST STAY INSIDE THE LANDMARK RING.
 *
 * Pushing it out to the prototype's 30 m was tried and it was a clear
 * regression: landmarks are placed on a ring at 0.50 to 0.88 of the basin
 * radius, which for a 36 m basin is 18 to 32 m, so a camera parked at 30 m
 * stands ON that ring. On the abyssal-plain fixture it came to rest 9.6 m from
 * the abyssal-trench landmark and that one landmark filled the frame with a
 * flat pale slab — measured as 0.603 luma against the prototype's 0.191, and
 * misread first as a seabed lighting fault.
 *
 * The prototype can orbit at 30 m because it has no landmarks at all; it is a
 * style study with boulders. Copying its radius without copying its emptiness
 * is how a number that works there breaks here. The generated 16-24 m sits just
 * inside the ring's inner edge, which is where it belongs: the landmarks are
 * content to look AT, not to stand in.
 */

/**
 * How far ahead the aim point sits.
 *
 * It must be measured from the CAMERA, not from the world origin, and that is
 * load-bearing rather than a detail. A target placed at the origin while the
 * camera orbits at 30 m makes the horizontal run to the target 30 m no matter
 * what pitch was asked for, so every angle comes out roughly halved: an intended
 * 60 degrees up renders as 27, which is OUTSIDE Snell's 48.6-degree cone. The
 * window then refuses to appear and the shader looks guilty.
 */
const OCEAN_AIM_DISTANCE_METRES = 20;

/**
 * Where to look, given which boundaries are in frame.
 *
 * These four angles are the prototype's, and they are the piece of it that had
 * no counterpart here at all: our camera always looked about 10 degrees DOWN,
 * because it sat above the origin and aimed at it, whatever was in frame.
 *
 * The costly case is the third. Open water near the surface — a 17 m world over
 * a 3 km floor, the prototype's best-looking frame — wants the lens 60 degrees
 * UP, because Snell's window is a 97-degree cone about the zenith and its edge
 * sits 41 degrees up, so nothing short of a steep upward look puts the window in
 * the frame at a 55-degree field of view. Ours looked down instead, into plain
 * dark water, which is why those views measured 0.19 luma below the reference
 * with saturation 0.34 over: the bright, desaturated window was never in shot.
 * No amount of gain on the window's own shader could have fixed that.
 */
function oceanCameraPitch(above: boolean, surfaceInReach: boolean, floorInReach: boolean): number {
  // Slightly down, toward the glitter path: the horizon and the specular track
  // are the subject, and looking up trades them for empty sky.
  //
  // -0.10, not the prototype's -0.32, and the difference comes from reading its
  // OUTPUT rather than its source. At a 55-degree field of view, -0.32 puts the
  // horizon 17% down the frame and gives the sky a sixth of the picture; the
  // prototype's own golden-hour still has it at about 40%, with the warm gradient
  // and the sun disc taking the top of the frame and the glitter path running
  // toward the viewer below. Those cannot both come from -0.32.
  //
  // They do not: the prototype eases its pitch in at 0.02 per frame from level,
  // so a screenshot taken a third of a second in is at roughly -0.10 and still
  // travelling. Its published frames are of an unsettled camera. Composing to the
  // image is right and composing to the constant is wrong, because the image is
  // the thing that was reviewed and liked. -0.096 rad is the pitch that lands the
  // horizon at 40%, rounded.
  if (above) return -0.1;
  // The one frame that can hold both boundaries. Tilted up, because the window
  // is worth more in the top third than an empty column is.
  if (surfaceInReach && floorInReach) return 0.22;
  if (surfaceInReach) return 0.72;
  // An abyssal plain: the floor is all there is.
  if (floorInReach) return -0.22;
  // A column with neither boundary. Nothing is privileged, so stay level.
  return 0;
}

export type OceanCameraFraming = {
  x: number;
  y: number;
  z: number;
  /**
   * Where the camera looks. Absolute world position, already offset from the
   * camera — see OCEAN_AIM_DISTANCE_METRES for why it cannot be the origin.
   */
  target: { x: number; y: number; z: number };
};

/**
 * Where to put the camera for an ocean world.
 *
 * # The sun is the subject whenever it can be seen
 *
 * Whenever the surface is in reach, everything worth looking at lives in ONE
 * direction: Snell's window, the god rays, the specular glitter path and the
 * sun's own disc are all on the sun's bearing, and a camera pointed anywhere
 * else in a sunlit ocean is pointed at nothing. That is why the prototype's
 * golden-hour preset ships an explicit yaw of 0 — it aims the lens at the sun —
 * and why the same view rendered here as a featureless grey band: the shared
 * framing pointed the camera wherever it liked.
 *
 * So the camera is placed on the far side of the origin from the sun, at
 * azimuth + π, because the shared rig always looks back at the origin. Its
 * forward direction is then the sun's bearing.
 *
 * # Except above water, under a high sun
 *
 * That forward direction shoots straight at the sun, and above the surface —
 * where the subject is the sky and the sea's own colour rather than a
 * refracted window — that is the one composition every guide to photographing
 * water warns against. Measured in the prototype: facing the sun gives an
 * above-water frame at saturation 0.12, facing `BLUE_SEA_YAW_OFFSET_RADIANS`
 * (118 degrees) away gives 0.17 overall and 0.31 in the near field, same
 * shaders, same exposure. Applied only above water (underwater the god rays
 * and Snell's window still need the sun's own bearing to have anything to
 * show) and only past `HIGH_SUN_ELEVATION_THRESHOLD_RADIANS` — a low, golden-
 * hour sun is the one case where shooting straight at it is the shot itself,
 * which is why the prototype's own golden-hour preset ships yaw 0 rather than
 * the offset.
 *
 * When neither boundary is in reach there is no privileged direction, and the
 * bearing is left as it was.
 */
export function oceanCameraFraming(
  distance: number,
  viewerDepthMetres: number,
  visibilityMetres: number,
  sunAzimuthRadians: number = OCEAN_SUN_AZIMUTH_RADIANS,
  seafloorDepthMetres: number = Number.POSITIVE_INFINITY,
  // At the threshold itself rather than above or below it: a caller with no
  // real elevation to pass (every existing test, before this parameter
  // existed) gets the offset OFF, exactly the behaviour this parameter did
  // not yet change.
  sunElevationRadians: number = HIGH_SUN_ELEVATION_THRESHOLD_RADIANS,
): OceanCameraFraming {
  const above = viewerDepthMetres < 0;
  const reach = visibilityMetres * BOUNDARY_SIGHT_MULTIPLIER;
  const surfaceInReach = above || viewerDepthMetres <= reach;
  const floorInReach = !above && seafloorDepthMetres - viewerDepthMetres <= reach;

  // The viewer floats at its OWN depth plane. The rig puts the origin at the
  // viewer, so height zero is the honest answer and the lift that used to be
  // here (0.18 of the orbit radius) was the shared rig's habit of looking down
  // at a target from outside, carried into a medium the camera is inside.
  const radius = distance;
  const bearing = surfaceInReach || floorInReach ? sunAzimuthRadians + Math.PI : Math.PI / 2;
  const position = {
    x: Math.cos(bearing) * radius,
    y: 0,
    z: Math.sin(bearing) * radius,
  };

  // Yaw back across the basin, so the frame looks at content rather than
  // outward into empty water — and, whenever the sun matters, along its
  // bearing. Above water under a high sun, turned away from it instead — see
  // BLUE_SEA_YAW_OFFSET_RADIANS.
  const highSunAboveWater = above && sunElevationRadians > HIGH_SUN_ELEVATION_THRESHOLD_RADIANS;
  const yaw = bearing + Math.PI + (highSunAboveWater ? BLUE_SEA_YAW_OFFSET_RADIANS : 0);
  const pitch = oceanCameraPitch(above, surfaceInReach, floorInReach);
  const horizontal = Math.cos(pitch) * OCEAN_AIM_DISTANCE_METRES;
  return {
    ...position,
    target: {
      x: position.x + Math.cos(yaw) * horizontal,
      y: position.y + Math.sin(pitch) * OCEAN_AIM_DISTANCE_METRES,
      z: position.z + Math.sin(yaw) * horizontal,
    },
  };
}

/**
 * The highest crest this sea actually reaches, as a multiple of its
 * significant wave height.
 *
 * Rayleigh statistics on a narrow-banded sea: over N waves the largest HEIGHT
 * tends to Hs * sqrt(ln(N) / 2), which over the thousand-odd waves a visitor
 * sits through is about 1.86 Hs, and a crest is half of a height.
 *
 * 0.93 rather than the Gerstner sum's own bound. Summing the twelve component
 * amplitudes gives 1.22 Hs, but that is every component cresting at the same
 * point at the same instant — true once in the life of the sea, not once a
 * minute, and buying a fifth of a shallow world's water column to insure
 * against it is a worse trade than the occasional grazed crest.
 */
const EXTREME_CREST_OVER_SIGNIFICANT_HEIGHT = 0.93;

/**
 * Clear of the near plane as well as of the water.
 *
 * OceanRenderer pushes the near plane out to 0.5 m for the duration of the rig,
 * so a lens exactly at the crest line would have the sheet INSIDE its near
 * plane and clip a hole through the sea rather than swim under it.
 */
const SURFACE_NEAR_PLANE_MARGIN_METRES = 0.6;

/**
 * How far below the mean waterline the lens has to stay.
 *
 * The surface is drawn as a Gerstner sheet whose base plane sits at the
 * viewer's own depth, so "the waterline" is a mean, not a lid: the sheet's
 * troughs hang below it by as much as its crests stand above it. A camera level
 * with the mean plane is already outside the water half the time.
 */
export function oceanSurfaceClearanceMetres(windSpeedMetresPerSecond: number): number {
  return (
    significantWaveHeightMetres(Math.max(0, windSpeedMetresPerSecond)) *
      EXTREME_CREST_OVER_SIGNIFICANT_HEIGHT +
    SURFACE_NEAR_PLANE_MARGIN_METRES
  );
}

/**
 * The height the lens may not pass, or null when nothing is over it.
 *
 * THIS IS THE FIX FOR THE WALL OF LIGHT, and the bug it closes was never a
 * shader bug. `createOceanRig` decides ONCE, at build time, whether the viewer
 * is above or below the water, and roughly fifteen decisions hang off that
 * boolean — which of the two surface materials is drawn, whether a seabed
 * exists at all, which species are in the roster. The orbit camera then moves
 * freely and can walk straight out of the medium the rig was built for.
 *
 * When it does, three things happen at once and they compound:
 *
 *   - the from-below surface shader is `DoubleSide` and its Snell's-window term
 *     is an ABSOLUTE dot product, so seen from above it reports a window
 *     everywhere and paints raw zenith sky across the whole sheet;
 *   - the only term that dims it is distance fog, and at one metre away that is
 *     four hundredths of one percent;
 *   - the sheet is 900 m across, opaque and depth-writing, and follows the
 *     camera. Every animal in the world is behind it.
 *
 * Which is exactly what the owner reported, in that order: a white frame, and
 * the fish gone with it. The camera height is `target.y + radius * cos(polar)`,
 * so it is the ZOOM that decides whether a given tilt breaches — the reason the
 * bug shows on zoom-out and not on zoom-in.
 *
 * Null above water: those worlds have no sheet over the lens to come out of.
 * They have the mirror problem — a camera that can dive UNDER their sea — which
 * is a different bound and is not what this returns.
 */
export function oceanCameraCeilingMetres(
  viewerDepthMetres: number,
  windSpeedMetresPerSecond: number,
): number | null {
  if (viewerDepthMetres < 0) {
    return null;
  }
  return viewerDepthMetres - oceanSurfaceClearanceMetres(windSpeedMetresPerSecond);
}

/**
 * The height the lens may not fall below, or null when there is nothing under
 * it to fall into.
 *
 * The mirror of `oceanCameraCeilingMetres`, and it closes the other half of the
 * same bug. An above-water world's rig is built for AIR — `createOceanRig`
 * takes the `above` branch once and roughly fifteen decisions hang off it: the
 * sea is drawn as a `SeaTop` seen from the sky rather than as the from-below
 * sheet, there is no seabed, no god rays, no water fog, no biolume layer, and
 * the roster is the surface one. An orbit that dives under that sea does not
 * arrive underwater; it arrives at a scene with no water in it at all, looking
 * up at the back of a wave mesh.
 *
 * Where the surface IS in scene coordinates is the one asymmetry worth stating.
 * The camera sits at height zero in both cases, and `viewerDepthMetres` is
 * signed: submerged it is how far the surface is ABOVE the lens, so the sheet
 * sits at `+viewerDepthMetres` and the ceiling is that minus the clearance;
 * above water it is negative, `createOceanRig` puts `seaTop.mesh.position.y` at
 * that same signed number, and the floor is that PLUS the clearance. One
 * clearance, one waterline, two signs.
 */
export function oceanCameraFloorMetres(
  viewerDepthMetres: number,
  windSpeedMetresPerSecond: number,
): number | null {
  if (viewerDepthMetres >= 0) {
    return null;
  }
  return viewerDepthMetres + oceanSurfaceClearanceMetres(windSpeedMetresPerSecond);
}
