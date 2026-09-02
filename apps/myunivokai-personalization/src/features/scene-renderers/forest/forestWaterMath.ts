import { smoothstepValue, type WaterOutline } from "./forestMath";

/**
 * The water surface's wave field and vertex grid.
 *
 * These numbers lived inside ForestPondWater, which made them unmeasurable: the
 * anti-fold guarantee in US-FOREST-001 ("no triangle inverts") is a relationship
 * between the wave table, the steepness and the grid, and a test cannot reach any
 * of it through a component that only writes GPU buffers. Nothing here touches
 * three.js — the component owns the buffers, this module owns the arithmetic.
 *
 * That story also offered a shorthand for the guarantee — that the lateral shift
 * never exceeds local vertex spacing. Do not use it. It is wrong in both
 * directions, and forestWaterMath.test.ts measures inverted area instead. See
 * TRIANGLE_FOLD_SAFETY_FRACTION.
 */

export type SurfaceWave = {
  directionX: number;
  directionY: number;
  wavelength: number;
  amplitude: number;
  speed: number;
};

/**
 * Travelling waves, longest first. Directions are deliberately NOT aligned and
 * the wavelengths are not integer multiples of each other, so the sum never
 * settles into a repeating pattern the way a tidy harmonic series would.
 * Amplitudes are in world units — a lake this size reads best with a few
 * centimetres of relief; more looks like a storm at sea.
 */
export const SURFACE_WAVES: SurfaceWave[] = [
  { directionX: 0.93, directionY: 0.37, wavelength: 12.7, amplitude: 0.125, speed: 0.6 },
  { directionX: 0.64, directionY: 0.77, wavelength: 9.1, amplitude: 0.088, speed: 0.68 },
  { directionX: -0.41, directionY: 0.91, wavelength: 6.3, amplitude: 0.062, speed: 0.79 },
  { directionX: 0.99, directionY: -0.14, wavelength: 4.7, amplitude: 0.045, speed: 0.9 },
  { directionX: 0.72, directionY: -0.69, wavelength: 3.3, amplitude: 0.032, speed: 1.02 },
  { directionX: -0.19, directionY: -0.98, wavelength: 2.4, amplitude: 0.023, speed: 1.16 },
  { directionX: -0.87, directionY: -0.49, wavelength: 1.7, amplitude: 0.015, speed: 1.33 },
  { directionX: 0.34, directionY: 0.94, wavelength: 1.2, amplitude: 0.009, speed: 1.5 }
];

/**
 * Gerstner steepness. Plain summed sines give symmetric, rounded swells — which
 * is what made the surface read as regular diagonal banding rather than water.
 * Real waves are SHARP at the crest and flat in the trough, and that asymmetry
 * comes from vertices moving HORIZONTALLY toward the crests, not from a taller
 * vertical wave. Above ~0.5 the displacement starts to fold the mesh over itself;
 * forestWaterMath.test.ts is what holds this honest.
 */
export const WAVE_STEEPNESS = 0.35;

/**
 * Angular segments in the water GRID, independent of the outline's own segment
 * count. Finer segments mean thinner triangles and less room to absorb the
 * sideways shift, which is why the outline's own 192 folded the surface almost
 * everywhere. 96 still resolves the shoreline comfortably (its highest harmonic
 * is 11).
 *
 * Fixed rather than scaled by radius, which is why the 1.7-unit landmark pond
 * ends up over-tessellated and leans hardest on the fold clamp.
 */
export const WATER_SURFACE_SEGMENT_COUNT = 96;

/**
 * Lateral displacement fades toward the centre, where all the angular segments
 * converge and spacing becomes tiny. Height is unaffected — only the sideways
 * crowding needs limiting, and near the middle it is invisible anyway.
 *
 * This one is about the centre, where all the angular segments meet. It is NOT
 * what keeps the mesh from folding near the shore — see
 * TRIANGLE_FOLD_SAFETY_FRACTION. Re-expressing this constant in ring units was
 * the first attempt at that fold and changed the worst case by nothing at all.
 */
export const LATERAL_CENTRE_CALM_FRACTION = 0.45;

/**
 * Rings of tessellation from centre to shore. This is the knob that decides
 * whether the surface has relief at all: at 1 it is the old flat fan.
 */
export const SURFACE_RING_COUNT = 22;

/**
 * Waves fade out over this fraction of the radius so the sheet stays welded to
 * the bank — an undulating edge would tear away from the shoreline band.
 */
export const SHORE_CALM_FRACTION = 0.16;

/** Below this a surface has too few rings to carry relief at all. */
const MINIMUM_RING_COUNT = 6;
/** Radius at which a surface earns the full ring budget; ponds get fewer. */
const RADIUS_FOR_FULL_RING_COUNT = 8;

/**
 * Ring count for a surface of this radius. The same component draws the lake and
 * the small landmark ponds, so the grid — and therefore the vertex spacing the
 * fold guarantee depends on — is radius-dependent.
 */
export function waterSurfaceRingCount(radius: number): number {
  return Math.max(
    MINIMUM_RING_COUNT,
    Math.round(SURFACE_RING_COUNT * Math.min(1, radius / RADIUS_FOR_FULL_RING_COUNT))
  );
}

/**
 * Rings bunch up toward the rim, where the depth gradient and the wave fade-out
 * both change fastest.
 */
export function waterSurfaceRingFraction(ringIndex: number, ringCount: number): number {
  return Math.sqrt((ringIndex + 1) / ringCount);
}

/**
 * Per-vertex wave amplitude: 0 at the shore, 1 in open water.
 *
 * Smoothstep, not linear: a linear taper leaves a visible crease where it starts,
 * and it keeps too much amplitude right at the rim — enough for a trough to dip
 * through the shoreline band it overlaps.
 */
export function waterSurfaceWaveScale(ringFraction: number): number {
  return smoothstepValue(0, 1, (1 - ringFraction) / SHORE_CALM_FRACTION);
}

/** Per-vertex scale on the SIDEWAYS shift, from the centre fade alone. */
export function waterSurfaceLateralScale(ringFraction: number): number {
  return smoothstepValue(0, 1, ringFraction / LATERAL_CENTRE_CALM_FRACTION);
}

/** Largest sideways shift the wave sum can produce, before any per-vertex scale. */
export function maximumLateralShift(): number {
  return WAVE_STEEPNESS * maximumSurfaceWaveHeight();
}

/**
 * Fraction of a triangle's own thickness the sideways field may spend.
 *
 * A triangle inverts when its vertices move by more, RELATIVE TO EACH OTHER, than
 * the room it has: its smallest altitude. Vertices that move together never fold
 * anything however far they travel, which is why an absolute shift-versus-spacing
 * rule is the wrong test — it reads as a fold across the open lake, where nothing
 * is wrong, and misses the shore, where something was.
 *
 * 0.8 leaves headroom for the wave field's own gradient, which the amplitudes hold
 * at about 0.16 per unit.
 */
export const TRIANGLE_FOLD_SAFETY_FRACTION = 0.8;

/**
 * Passes of the clamp below. Reducing one triangle can leave a neighbour that
 * shares its vertices still over budget, so it repeats until nothing changes.
 * Two is the most any shipped surface has needed; the cap only bounds the loop.
 */
const MAXIMUM_FOLD_CLAMP_PASSES = 8;

function triangleMinimumAltitude(
  restPositions: Float32Array,
  vertexA: number,
  vertexB: number,
  vertexC: number
): number {
  const ax = restPositions[vertexA * 2];
  const ay = restPositions[vertexA * 2 + 1];
  const bx = restPositions[vertexB * 2];
  const by = restPositions[vertexB * 2 + 1];
  const cx = restPositions[vertexC * 2];
  const cy = restPositions[vertexC * 2 + 1];
  const twiceArea = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
  const longestEdge = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - bx, cy - by), Math.hypot(ax - cx, ay - cy));
  return longestEdge > 0 ? twiceArea / longestEdge : 0;
}

/**
 * Hold the sideways field down to what each triangle can absorb.
 *
 * Without this the landmark ponds fold. Their shoreline is steep enough, relative
 * to a 1.7-unit radius, that a vertex on the last interior ring can sit FURTHER
 * out than a rim vertex beside it; the triangle between them is a sliver about
 * 0.07 units thick, the rim is frozen by the shore fade and the interior vertex
 * is not, and it walks straight through the opposite edge.
 *
 * How hard it works, measured over 200 seeds per size:
 *
 *     radius 1.70 (pond)          88% of vertices clamped, down to 0.001x
 *     radius 10.80 (small lake)  0.05% of vertices clamped, never below 0.85x
 *     radius 12.15 and above     untouched
 *
 * So the hero water keeps its crests and the pond gives up most of its sideways
 * crowding — which is the right trade, because the pond was buying that crowding
 * with inverted triangles. Wave HEIGHT is untouched at every size, so no surface
 * loses its relief. The pond is over-tessellated for its size at 96 angular
 * segments; scaling segments with radius the way rings already are would give it
 * room to keep more of the field, and is the better fix if it ever matters.
 *
 * Scaling all three vertices of an offending triangle by the same factor scales
 * every pairwise difference by exactly that factor, which is what makes one clamp
 * sufficient rather than approximate. Only the lateral scale moves: wave height is
 * left alone, so the surface keeps its relief.
 */
function clampLateralScalesToTriangleRoom(
  restPositions: Float32Array,
  waveScales: Float32Array,
  lateralScales: Float32Array,
  ringCount: number
): void {
  const triangleIndices = waterSurfaceTriangleIndices(ringCount);
  const maximumShift = maximumLateralShift();

  for (let pass = 0; pass < MAXIMUM_FOLD_CLAMP_PASSES; pass += 1) {
    let clampedAnything = false;
    for (let cursor = 0; cursor < triangleIndices.length; cursor += 3) {
      const vertexA = triangleIndices[cursor];
      const vertexB = triangleIndices[cursor + 1];
      const vertexC = triangleIndices[cursor + 2];
      const shiftA = waveScales[vertexA] * lateralScales[vertexA];
      const shiftB = waveScales[vertexB] * lateralScales[vertexB];
      const shiftC = waveScales[vertexC] * lateralScales[vertexC];
      const spread = Math.max(shiftA, shiftB, shiftC) - Math.min(shiftA, shiftB, shiftC);
      if (spread <= 0) {
        continue;
      }
      const room = TRIANGLE_FOLD_SAFETY_FRACTION * triangleMinimumAltitude(restPositions, vertexA, vertexB, vertexC);
      const allowedSpread = room / maximumShift;
      if (spread <= allowedSpread) {
        continue;
      }
      const factor = allowedSpread / spread;
      lateralScales[vertexA] *= factor;
      lateralScales[vertexB] *= factor;
      lateralScales[vertexC] *= factor;
      clampedAnything = true;
    }
    if (!clampedAnything) {
      return;
    }
  }
}

/**
 * Angular gap between neighbouring vertices on a ring — the distance a lateral
 * shift has to stay under. Radial gaps are wider everywhere the grid is used, so
 * this is the binding constraint.
 */
export function waterSurfaceAngularVertexSpacing(vertexRadius: number): number {
  return (vertexRadius * Math.PI * 2) / WATER_SURFACE_SEGMENT_COUNT;
}

export type WaterSurfaceRestGrid = {
  /** Undisplaced XY per vertex, vertex 0 being the centre. */
  restPositions: Float32Array;
  waveScales: Float32Array;
  lateralScales: Float32Array;
  /** 0 at the centre, 1 at the shore — the component shades depth from this. */
  ringFractions: Float32Array;
};

export function waterSurfaceVertexCount(ringCount: number): number {
  return 1 + ringCount * (WATER_SURFACE_SEGMENT_COUNT + 1);
}

/**
 * The surface's rest geometry: a real radial grid rather than a fan, because
 * displacement needs vertices to displace and a fan has none between the centre
 * and the rim.
 *
 * Built in the XY plane so the caller's -PI/2 X rotation lays it flat, which means
 * the surface height is the LOCAL Z coordinate.
 *
 * The renderer and forestWaterMath.test.ts both build their grid from here. A test
 * that reconstructed the layout itself would prove a property of its own copy.
 */
export function waterSurfaceRestGrid(radius: number, outline: WaterOutline, ringCount: number): WaterSurfaceRestGrid {
  const segments = WATER_SURFACE_SEGMENT_COUNT;
  const vertexCount = waterSurfaceVertexCount(ringCount);
  const restPositions = new Float32Array(vertexCount * 2);
  const waveScales = new Float32Array(vertexCount);
  const lateralScales = new Float32Array(vertexCount);
  const ringFractions = new Float32Array(vertexCount);

  // Vertex 0 is the centre, at ring fraction 0. The formulas below give it rest
  // position (0, 0), full wave height and zero lateral shift, so it needs no
  // special case.
  waveScales[0] = waterSurfaceWaveScale(0);
  lateralScales[0] = waterSurfaceLateralScale(0);

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const ringFraction = waterSurfaceRingFraction(ringIndex, ringCount);
    const waveScale = waterSurfaceWaveScale(ringFraction);
    const lateralScale = waterSurfaceLateralScale(ringFraction);
    for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
      const angle = (segmentIndex / segments) * Math.PI * 2;
      const vertexRadius = radius * outline.radiusFactorAt(angle) * ringFraction;
      const vertexIndex = 1 + ringIndex * (segments + 1) + segmentIndex;
      restPositions[vertexIndex * 2] = Math.cos(angle) * vertexRadius;
      restPositions[vertexIndex * 2 + 1] = Math.sin(angle) * vertexRadius;
      waveScales[vertexIndex] = waveScale;
      lateralScales[vertexIndex] = lateralScale;
      ringFractions[vertexIndex] = ringFraction;
    }
  }

  // Last, because it needs the finished rest layout to know how much room each
  // triangle has.
  clampLateralScalesToTriangleRoom(restPositions, waveScales, lateralScales, ringCount);

  return { restPositions, waveScales, lateralScales, ringFractions };
}

/**
 * Triangle list over that grid. The first ring fans from the centre vertex; every
 * ring after it is quads split into two triangles.
 */
export function waterSurfaceTriangleIndices(ringCount: number): number[] {
  const segments = WATER_SURFACE_SEGMENT_COUNT;
  const indices: number[] = [];
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const vertexIndex = 1 + ringIndex * (segments + 1) + segmentIndex;
      if (ringIndex === 0) {
        indices.push(0, vertexIndex, vertexIndex + 1);
      } else {
        const innerVertexIndex = vertexIndex - (segments + 1);
        indices.push(innerVertexIndex, vertexIndex, vertexIndex + 1);
        indices.push(innerVertexIndex, vertexIndex + 1, innerVertexIndex + 1);
      }
    }
  }
  return indices;
}

export type SurfaceDisplacement = {
  /** Surface height, the surface's local +Z. */
  height: number;
  /** Sideways Gerstner shift away from the rest position. */
  shiftX: number;
  shiftY: number;
  /** Analytic height gradient, for the normal. */
  slopeX: number;
  slopeY: number;
};

export function createSurfaceDisplacement(): SurfaceDisplacement {
  return { height: 0, shiftX: 0, shiftY: 0, slopeX: 0, slopeY: 0 };
}

/**
 * Displacement of one vertex at one instant, written into `target`.
 *
 * The caller supplies a reused target rather than receiving a fresh object,
 * because this runs for every vertex of every water surface on every frame and a
 * per-vertex allocation there is thousands of short-lived objects per second.
 *
 * `restX`/`restY` MUST be the undisplaced position. Gerstner waves move vertices
 * sideways, so reading the phase back from the live position attribute feeds the
 * displacement into its own input and the surface drifts away every frame.
 */
export function applyGerstnerSurfaceDisplacement(
  target: SurfaceDisplacement,
  restX: number,
  restY: number,
  elapsedSeconds: number,
  waveScale: number,
  lateralScale: number
): void {
  target.height = 0;
  target.shiftX = 0;
  target.shiftY = 0;
  target.slopeX = 0;
  target.slopeY = 0;

  for (const wave of SURFACE_WAVES) {
    const angularFrequency = (Math.PI * 2) / wave.wavelength;
    const phase =
      (wave.directionX * restX + wave.directionY * restY) * angularFrequency -
      elapsedSeconds * wave.speed * angularFrequency;
    const amplitude = wave.amplitude * waveScale;
    const sinPhase = Math.sin(phase);
    const cosPhase = Math.cos(phase);
    target.height += amplitude * sinPhase;
    // Gerstner: vertices crowd toward the crests, which sharpens them and
    // flattens the troughs. Scaled by waveScale as well, so the rim stays put.
    const lateral = WAVE_STEEPNESS * amplitude * lateralScale * cosPhase;
    target.shiftX += lateral * wave.directionX;
    target.shiftY += lateral * wave.directionY;
    const slopeTerm = amplitude * angularFrequency * cosPhase;
    target.slopeX += slopeTerm * wave.directionX;
    target.slopeY += slopeTerm * wave.directionY;
  }
}

/** Largest height the wave sum can reach in open water. */
export function maximumSurfaceWaveHeight(): number {
  return SURFACE_WAVES.reduce((sum, wave) => sum + wave.amplitude, 0);
}
