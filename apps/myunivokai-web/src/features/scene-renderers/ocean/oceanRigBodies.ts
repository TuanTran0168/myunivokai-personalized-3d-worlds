/**
 * Procedural creature bodies.
 *
 * # Why these exist when the repository owns twelve GLBs
 *
 * The rig used to be GLB-only: every school was created with a one-vertex
 * placeholder and `visible = false`, and became visible when its `.glb`
 * resolved. Two consequences, both of them visible in every frame:
 *
 *   - **A species with no GLB can never appear.** Four of the prototype's
 *     fourteen have no model file, because the prototype builds them from
 *     maths — and those four are the MASS schools: silversides (1400), anthias
 *     (340), lanternfish (300), anglerfish (4). Add the jellyfish layer (110)
 *     and 2154 of 2550 animals were simply absent. That is the whole reason the
 *     app's water column read as empty next to the prototype's.
 *   - **A failed or slow fetch is an empty ocean.** Nothing degrades; the
 *     animals are either all there or not there at all.
 *
 * The prototype's own arrangement is the opposite, and it is the right one:
 * build a procedural body ALWAYS, then adopt a real GLB over it when one
 * arrives. Procedural is the floor, the model is the upgrade, and the frame is
 * never empty while waiting. Its loader even reports
 * `__oceanModelsLoaded = "unavailable"` and carries on looking correct when the
 * catalogue is missing entirely.
 *
 * # The design rule these shapes follow
 *
 * Silhouette first — the Abzu lesson. Pick the two or three features that
 * identify a species and drop everything else: a dolphin is a melon head and
 * HORIZONTAL flukes, a shark is a pointed snout and a heterocercal tail whose
 * upper lobe is longer, a lanternfish is a blunt head and rows of photophores.
 * Get those right at 20 m and nobody looks for scales.
 *
 * Every body is built about +Z with the head at +Z, and carries an `along`
 * attribute running 0 at the snout to 1 at the tail — which is what lets the
 * swim shader taper a travelling wave along the body. That is the same contract
 * `normaliseModel` gives an adopted GLB, so the two are interchangeable.
 */
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/**
 * A fusiform half-width profile: zero at the snout, shoulder forward of centre,
 * pinched to a peduncle at the tail.
 *
 * `shoulder` and `taper` are the two exponents; the normalising constant pins
 * the peak to 1 so `halfWidth` means what it says rather than being a number
 * that has to be re-tuned every time an exponent moves.
 */
export function fusiform(
  shoulder: number,
  taper: number,
  halfWidth: number,
): (t: number) => number {
  const peak = shoulder / (shoulder + taper);
  const norm = 1 / (Math.pow(peak, shoulder) * Math.pow(1 - peak, taper));
  return (t) =>
    Math.pow(Math.max(0, t), shoulder) * Math.pow(Math.max(0, 1 - t), taper) * norm * halfWidth;
}

type Fin = {
  plane: "vertical" | "horizontal";
  root: number;
  tip: number;
  /** Vertical fins only: the far corner, which is what makes a tail forked. */
  tip2?: number;
  z0: number;
  z1: number;
  z2?: number;
  z3?: number;
  /** Where along the body this fin sits, so the wave reaches it in phase. */
  along: number;
};

type BodyOptions = {
  profile: (t: number) => number;
  widthRatio: number;
  heightRatio: number;
  lengthSegments?: number;
  radialSegments?: number;
  fins?: Fin[];
};

/** A body of revolution about +Z, head at +Z, with fins as double-sided quads. */
function bodyGeometry(options: BodyOptions): BufferGeometry {
  const lengthSegments = options.lengthSegments ?? 15;
  const radialSegments = options.radialSegments ?? 10;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const normal = new Vector3();

  for (let s = 0; s <= lengthSegments; s += 1) {
    const t = s / lengthSegments;
    const z = 0.5 - t;
    const radius = Math.max(0.01, options.profile(t));
    for (let r = 0; r <= radialSegments; r += 1) {
      const angle = (r / radialSegments) * Math.PI * 2;
      const x = Math.cos(angle) * radius * options.widthRatio;
      const y = Math.sin(angle) * radius * options.heightRatio;
      positions.push(x, y, z);
      // The 0.18 in z biases the normal forward so a body of revolution does not
      // shade as a cylinder cut off at both ends.
      normal.set(x, y, 0.18).normalize();
      normals.push(normal.x, normal.y, normal.z);
      along.push(t);
      // u wraps exactly once around the revolve (angle / 2pi), v runs head to
      // tail — the same cylindrical parameterisation createSandTextures already
      // bakes noise on, chosen for the same reason: a wrap-safe u is what makes
      // a tileable skin texture possible at all. sin(angle) = -1 is the belly
      // (y most negative — see the vBelly countershading this shares the sign
      // convention with), which is u = 0.75 here.
      uvs.push(r / radialSegments, t);
    }
  }
  for (let s = 0; s < lengthSegments; s += 1) {
    for (let r = 0; r < radialSegments; r += 1) {
      const a = s * (radialSegments + 1) + r;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // Fins are flat quads wound BOTH ways: a fin is a membrane, and a fish seen
  // from its other side with back-face culling on loses its tail.
  //
  // u = 0.5 for every fin vertex — a fixed strip down the middle of the skin
  // texture's u range, deliberately away from the belly seam at u = 0.75. A
  // fin is not skin and does not need real texture space; it only needs to
  // sample somewhere that is not one of the lanternfish's photophore rows.
  const quad = (
    corners: readonly [number, number, number][],
    alongValue: number,
    faceNormal: readonly [number, number, number],
  ) => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(faceNormal[0], faceNormal[1], faceNormal[2]);
      along.push(alongValue);
      uvs.push(0.5, alongValue);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (const fin of options.fins ?? []) {
    if (fin.plane === "vertical") {
      quad(
        [
          [0, fin.root, fin.z0],
          [0, fin.tip, fin.z1],
          [0, fin.tip2 ?? fin.tip, fin.z2 ?? fin.z1],
          [0, fin.root, fin.z3 ?? fin.z0],
        ],
        fin.along,
        [1, 0, 0],
      );
    } else {
      // Horizontal: cetacean flukes and pectorals. A vertical tail is the one
      // mistake that turns a dolphin back into a fish.
      quad(
        [
          [fin.root, 0, fin.z0],
          [fin.tip, 0, fin.z1],
          [-fin.tip, 0, fin.z1],
          [-fin.root, 0, fin.z0],
        ],
        fin.along,
        [0, 1, 0],
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A batoid disc: span across X, chord along Z, thin in Y. */
function wingGeometry(halfSpan: number, chord: number): BufferGeometry {
  const spanSegments = 24;
  const chordSegments = 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= spanSegments; i += 1) {
    const u = (i / spanSegments) * 2 - 1;
    const absU = Math.abs(u);
    // Swept leading edge and a tapering trailing edge: the manta outline.
    const chordScale = Math.pow(1 - Math.pow(absU, 2.1), 0.62);
    const sweep = -Math.pow(absU, 1.7) * 0.3;
    for (let j = 0; j <= chordSegments; j += 1) {
      const v = j / chordSegments;
      const z = 0.5 - v;
      const thickness = (1 - Math.pow(absU, 0.8)) * Math.sin(Math.PI * v) * 0.075;
      positions.push(u * halfSpan, thickness, (z * chordScale + sweep) * chord);
      normals.push(0, 1, 0);
      along.push(v);
    }
  }
  for (let i = 0; i < spanSegments; i += 1) {
    for (let j = 0; j < chordSegments; j += 1) {
      const a = i * (chordSegments + 1) + j;
      const b = a + chordSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // The whip tail is most of what says "ray" at silhouette scale.
  const base = positions.length / 3;
  const tailLength = chord * 1.5;
  const tailSegments = 6;
  for (let k = 0; k <= tailSegments; k += 1) {
    const t = k / tailSegments;
    const width = (1 - t) * chord * 0.05 + 0.004;
    const z = -chord * 0.5 - t * tailLength;
    positions.push(-width, 0, z, width, 0, z);
    normals.push(0, 1, 0, 0, 1, 0);
    along.push(1, 1);
  }
  for (let k = 0; k < tailSegments; k += 1) {
    const a = base + k * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    indices.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Concatenates several procedural bodies (mantle + arms) into one geometry,
 * with index offsets adjusted — the same job oceanRigFauna.ts's mergeParts
 * does for loaded GLB sub-meshes, but for the position/normal/along/uv
 * attribute set bodyGeometry() and tentacleGeometry() produce rather than the
 * position/normal/color set a GLTF mesh carries.
 */
function mergeGeometries(parts: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const base = positions.length / 3;
    const position = part.getAttribute("position");
    const normal = part.getAttribute("normal");
    const alongAttribute = part.getAttribute("along");
    const uv = part.getAttribute("uv");
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      along.push(alongAttribute.getX(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const partIndex = part.getIndex();
    if (partIndex) {
      for (let i = 0; i < partIndex.count; i += 1) indices.push(base + partIndex.getX(i));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

type TentacleOptions = {
  /** Where around the mantle's rim this arm attaches. */
  baseAngle: number;
  baseRadius: number;
  /** How far it trails behind the mantle, in the same units as the mantle's own length. */
  length: number;
  baseThickness: number;
  tipThickness: number;
  /** How far the ring centre sags outward (away from the Z axis) by the tip, quadratically. */
  droop: number;
  /** Where in the shared `along` range this arm's base and tip sit — see buildCephalopod. */
  along0: number;
  along1: number;
  /** A thickness bump in the last ~15% of the length, for the two long feeding tentacles' terminal club. */
  clubBoost?: number;
  radialSegments?: number;
  lengthSegments?: number;
};

/**
 * One arm or tentacle: a tube trailing behind the mantle at z = mantleTailZ
 * and beyond, its ring CENTRE drifting outward from a straight radial line as
 * it extends (the droop) rather than tracking a true curving centreline —
 * the same simplification wingGeometry()'s own whip tail already makes, and
 * for the same reason: at this scene's viewing distance it reads as a
 * trailing streamer either way, and a true parallel-transported tube is a
 * much larger amount of code for a difference nobody will see.
 */
function tentacleGeometry(mantleTailZ: number, options: TentacleOptions): BufferGeometry {
  const radialSegments = options.radialSegments ?? 5;
  const lengthSegments = options.lengthSegments ?? 7;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const dirX = Math.cos(options.baseAngle);
  const dirY = Math.sin(options.baseAngle);

  for (let s = 0; s <= lengthSegments; s += 1) {
    const tLocal = s / lengthSegments;
    const z = mantleTailZ - tLocal * options.length;
    const ringRadius = options.baseRadius + options.droop * tLocal * tLocal;
    const centreX = dirX * ringRadius;
    const centreY = dirY * ringRadius;
    let thickness = options.baseThickness + (options.tipThickness - options.baseThickness) * tLocal;
    if (options.clubBoost) {
      const clubEnvelope = Math.max(0, (tLocal - 0.85) / 0.15);
      thickness *= 1 + options.clubBoost * clubEnvelope * clubEnvelope;
    }
    const alongValue = options.along0 + tLocal * (options.along1 - options.along0);
    for (let r = 0; r <= radialSegments; r += 1) {
      const angle = (r / radialSegments) * Math.PI * 2;
      const x = centreX + Math.cos(angle) * thickness;
      const y = centreY + Math.sin(angle) * thickness;
      positions.push(x, y, z);
      normals.push(Math.cos(angle), Math.sin(angle), 0.1);
      along.push(alongValue);
      // v continues from where the mantle's own v leaves off (see
      // buildCephalopod); every arm reuses the same strip since they are all
      // textured alike regardless of which arm they are.
      uvs.push(r / radialSegments, 0.35 + tLocal * 0.65);
    }
  }
  for (let s = 0; s < lengthSegments; s += 1) {
    for (let r = 0; r < radialSegments; r += 1) {
      const a = s * (radialSegments + 1) + r;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

type CephalopodOptions = {
  armCount: number;
  /** Radians the arms spread across, centred on the +Y axis. 2π for a full crown (giant squid). */
  armArcRadians: number;
  /** Vampire squid has none; giant squid's two long feeding tentacles are the family's signature. */
  longTentacles: boolean;
};

/**
 * A mantle (bodyGeometry, same as every fish archetype) plus a crown of
 * trailing arms (tentacleGeometry, above) — decapod and octopod are both
 * thin wrappers around this, differing only in arm count/spread and whether
 * two long tentacles join the crown.
 *
 * Authored mantle-forward: the mantle is comparatively RIGID and the arms are
 * the whippy anatomy, the opposite of where a fish's head sits relative to
 * its tail. The mantle is therefore built at the shader's rigid end (the
 * usual t = 0 nose) and the arms extend PAST t = 1 (the usual tail), which
 * the undulation envelope's own formula already allows since it never clamps
 * its upper end — the longest, whippiest tentacle tips simply get MORE
 * motion than the rest of the body, which is the desired trailing-streamer
 * look. This also happens to be one of the two ways real squid actually
 * swim (mantle-forward cruising), so it is not a biological compromise.
 *
 * The combined mantle+arms geometry is explicitly RENORMALISED to unit
 * length at the end, the same way normaliseModel() renormalises an adopted
 * GLB — every other archetype in this file is already unit-length by
 * construction (bodyGeometry alone never exceeds z = ±0.5), which is what
 * lets `FaunaSpecies.size` mean "real body length in metres" uniformly. A
 * cephalopod's arms trail well past that span, so without this step its
 * `size` would stop meaning the same thing every other species' does.
 */
function buildCephalopod(options: CephalopodOptions): BufferGeometry {
  const mantle = bodyGeometry({
    lengthSegments: 14,
    // A base term keeps the neck (t = 0, where the arm crown attaches) from
    // tapering to zero the way a fish nose does; fusiform gives the true
    // widest point aft of the neck, tapering to a near-point at the mantle's
    // posterior tip.
    profile: (t) => 0.22 * (1 - t * 0.55) + fusiform(0.9, 2.4, 0.4)(t),
    widthRatio: 0.85,
    heightRatio: 0.7,
    fins: [{ plane: "horizontal", root: 0.05, tip: 0.3, z0: -0.42, z1: -0.52, along: 0.92 }],
  });
  // Compressed into [0, MANTLE_ALONG_SPAN] so the arm crown, starting at
  // ARM_ALONG_SPAN below, continues the SAME 0-to-tail progression rather
  // than the mantle separately claiming the full 0-1 range on its own.
  const MANTLE_ALONG_SPAN = 0.7;
  const mantleAlong = mantle.getAttribute("along");
  for (let i = 0; i < mantleAlong.count; i += 1) mantleAlong.setX(i, mantleAlong.getX(i) * MANTLE_ALONG_SPAN);
  // v likewise compressed into the first slice of the shared texture strip,
  // so the arms (below) can start where the mantle's own v leaves off.
  const mantleUv = mantle.getAttribute("uv");
  for (let i = 0; i < mantleUv.count; i += 1) mantleUv.setY(i, mantleUv.getY(i) * 0.35);

  const mantleTailZ = -0.5;
  const mantleRimRadius = 0.09;
  const parts: BufferGeometry[] = [mantle];

  for (let i = 0; i < options.armCount; i += 1) {
    const spread = options.armCount > 1 ? i / (options.armCount - 1) - 0.5 : 0;
    const angle = Math.PI / 2 + spread * options.armArcRadians;
    parts.push(
      tentacleGeometry(mantleTailZ, {
        baseAngle: angle,
        baseRadius: mantleRimRadius,
        length: 0.9,
        baseThickness: 0.035,
        tipThickness: 0.008,
        droop: 0.25,
        along0: MANTLE_ALONG_SPAN,
        along1: 1.0,
      }),
    );
  }

  if (options.longTentacles) {
    for (const angle of [Math.PI / 2 - 0.35, Math.PI / 2 + Math.PI + 0.35]) {
      parts.push(
        tentacleGeometry(mantleTailZ, {
          baseAngle: angle,
          baseRadius: mantleRimRadius,
          length: 1.4,
          baseThickness: 0.025,
          tipThickness: 0.006,
          droop: 0.18,
          along0: 0.75,
          along1: 1.15,
          clubBoost: 0.6,
        }),
      );
    }
  }

  const merged = mergeGeometries(parts);
  merged.computeBoundingBox();
  const size = new Vector3();
  merged.boundingBox?.getSize(size);
  const centre = new Vector3();
  merged.boundingBox?.getCenter(centre);
  merged.translate(-centre.x, -centre.y, -centre.z);
  const span = Math.max(1e-4, size.z);
  merged.scale(1 / span, 1 / span, 1 / span);
  return merged;
}

/**
 * A seahorse: a small horse-like head/neck (bodyGeometry, same construction
 * as every fish archetype) plus one curving trunk-and-tail tube built from
 * the SAME tentacleGeometry() helper the cephalopod arms use — the plan that
 * deferred this species called a seahorse's bent, curling body "a body plan
 * that doesn't fit a Z-axis revolve at all", which is true of the WHOLE
 * animal but not of either half separately: the head is an ordinary small
 * revolve, and the trunk is exactly the curving-axis tube already built for
 * cephalopod arms, just carrying the whole animal instead of trailing behind
 * a mantle.
 *
 * The head occupies along [0, HEAD_ALONG_SPAN] (the same compression
 * buildCephalopod's mantle uses); the trunk continues from there to 1.15 —
 * PAST the usual tail end, since a real seahorse's tail is the most actively
 * curling part of the animal (it anchors with it) and the shared undulation
 * formula already gives values beyond 1 MORE motion with no new uniform,
 * which is the desired "tail curls more than the body" read for free.
 */
function buildSeahorse(): BufferGeometry {
  const HEAD_ALONG_SPAN = 0.22;
  const head = bodyGeometry({
    lengthSegments: 8,
    radialSegments: 8,
    // A brow bump forward of centre (the horse-head silhouette), tapering to
    // a thin tubular snout at t = 0 and to the neck's attach width at t = 1.
    profile: (t) => fusiform(0.7, 1.6, 0.34)(t) + 0.05,
    widthRatio: 0.6,
    heightRatio: 0.85,
    fins: [
      // The single dorsal fin real seahorses use to scull, at the neck/trunk
      // seam where the head hands off to the curving body below.
      { plane: "vertical", root: 0.02, tip: 0.24, tip2: 0.16, z0: -0.02, z1: -0.18, z2: -0.3, z3: -0.14, along: 1 },
    ],
  });
  const headAlong = head.getAttribute("along");
  for (let i = 0; i < headAlong.count; i += 1) headAlong.setX(i, headAlong.getX(i) * HEAD_ALONG_SPAN);
  const headUv = head.getAttribute("uv");
  for (let i = 0; i < headUv.count; i += 1) headUv.setY(i, headUv.getY(i) * 0.3);

  const trunk = tentacleGeometry(-0.5, {
    baseAngle: Math.PI / 2,
    baseRadius: 0.02,
    length: 1.55,
    baseThickness: 0.09,
    tipThickness: 0.012,
    // A real seahorse curls its tail into a tight spiral; a single quadratic
    // droop (the same simplification the cephalopod arms and the ray's whip
    // tail already make) reads as a strong forward curl at this silhouette
    // scale without a true parallel-transported spline.
    droop: 0.75,
    along0: HEAD_ALONG_SPAN,
    along1: 1.15,
    radialSegments: 7,
    lengthSegments: 16,
  });

  const merged = mergeGeometries([head, trunk]);
  merged.computeBoundingBox();
  const size = new Vector3();
  merged.boundingBox?.getSize(size);
  const centre = new Vector3();
  merged.boundingBox?.getCenter(centre);
  merged.translate(-centre.x, -centre.y, -centre.z);
  const span = Math.max(1e-4, size.z);
  merged.scale(1 / span, 1 / span, 1 / span);
  return merged;
}

/**
 * The silhouettes this rig's whole species roster is drawn from.
 *
 * Sharing is deliberate rather than a saving: a lionfish, a butterflyfish, a
 * turbot and a blobfish are all "a fish" at silhouette scale, and what
 * distinguishes them in frame is size, colour, depth band and how they MOVE —
 * which is the `SwimStyle`, not the mesh. A handful also have a real GLB that
 * replaces the shared shape as soon as it loads. `decapod`/`octopod` are the
 * one pair built from a genuinely different construction — see
 * buildCephalopod above.
 */
export type BodyArchetype =
  | "reefFish"
  | "shark"
  | "dolphin"
  | "whale"
  | "manta"
  | "anglerfish"
  | "lanternfish"
  | "viperfish"
  | "dragonfish"
  | "fangtooth"
  | "gulperEel"
  | "hatchetfish"
  | "ribbon"
  | "isopod"
  | "decapod"
  | "octopod"
  | "turtle"
  | "seahorse";

const BUILDERS: Record<BodyArchetype, () => BufferGeometry> = {
  // Jacks and herring: the schooling default. The posterior 30-50% undulates.
  // radialSegments raised from the bodyGeometry default of 10: this is the
  // archetype every forever-procedural near-field reef schooler (silversides,
  // anthias, clownfish, pufferfish, angelfish) is seen through at close range,
  // where a 10-sided cross-section reads as a visibly faceted decagon rather
  // than a smooth-bodied fish.
  reefFish: () =>
    bodyGeometry({
      radialSegments: 16,
      profile: fusiform(0.62, 1.25, 0.3),
      widthRatio: 0.34,
      heightRatio: 1.25,
      fins: [
        { plane: "vertical", root: 0, tip: 0.42, tip2: -0.42, z0: -0.5, z1: -0.72, z2: -0.72, z3: -0.5, along: 1 },
        { plane: "vertical", root: 0.06, tip: 0.34, tip2: 0.05, z0: 0.1, z1: -0.16, z2: -0.26, z3: -0.26, along: 0.5 },
      ],
    }),
  // Thunniform: rigid forebody, all the work at the peduncle. Pointed snout,
  // tall first dorsal, and a heterocercal tail whose upper lobe is longer —
  // that asymmetry is the shark tell.
  // radialSegments raised from the bodyGeometry default of 10: the one
  // species with FaunaSpecies.approachesCamera (the shark) scripts a close
  // pass in front of the lens, and a coarse cross-section that is invisible
  // at cruising distance turns visibly polygonal exactly during that pass.
  shark: () =>
    bodyGeometry({
      lengthSegments: 19,
      radialSegments: 16,
      profile: fusiform(0.5, 1.55, 0.17),
      widthRatio: 0.66,
      heightRatio: 1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.52, tip2: -0.26, z0: -0.46, z1: -0.78, z2: -0.66, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.4, tip2: 0.06, z0: 0.12, z1: -0.06, z2: -0.22, z3: -0.22, along: 0.45 },
        { plane: "horizontal", root: 0.09, tip: 0.44, z0: 0.16, z1: -0.02, along: 0.4 },
      ],
    }),
  // A cetacean. Blunt melon, curved dorsal, and flukes that are HORIZONTAL.
  dolphin: () =>
    bodyGeometry({
      lengthSegments: 19,
      profile: (t) => fusiform(0.44, 1.5, 0.165)(t) * (1 - 0.18 * t) + 0.008,
      widthRatio: 0.78,
      heightRatio: 0.92,
      fins: [
        { plane: "horizontal", root: 0.03, tip: 0.4, z0: -0.44, z1: -0.62, along: 1 },
        { plane: "vertical", root: 0.06, tip: 0.3, tip2: 0.05, z0: 0.06, z1: -0.1, z2: -0.24, z3: -0.24, along: 0.5 },
        { plane: "horizontal", root: 0.1, tip: 0.34, z0: 0.18, z1: 0.02, along: 0.4 },
      ],
    }),
  // A rorqual. Everything about it is scale: the beat is slow because beat
  // frequency falls with size, and the pectoral flippers are enormous — which is
  // the humpback silhouette in one feature.
  whale: () =>
    bodyGeometry({
      lengthSegments: 22,
      profile: (t) => fusiform(0.5, 1.25, 0.15)(t) * (1 - 0.1 * t) + 0.006,
      widthRatio: 0.82,
      heightRatio: 1,
      fins: [
        { plane: "horizontal", root: 0.02, tip: 0.3, z0: -0.46, z1: -0.6, along: 1 },
        { plane: "vertical", root: 0.04, tip: 0.13, tip2: 0.04, z0: -0.12, z1: -0.22, z2: -0.3, z3: -0.3, along: 0.6 },
        { plane: "horizontal", root: 0.06, tip: 0.46, z0: 0.24, z1: -0.06, along: 0.3 },
      ],
    }),
  manta: () => wingGeometry(0.5, 0.55),
  // Sit-and-wait ambush. The esca — a sac of glowing bacteria on the illicium —
  // is the entire animal at 2000 m, and it is the reason the abyss can have a
  // light source that is also a character.
  anglerfish: () =>
    bodyGeometry({
      lengthSegments: 13,
      profile: fusiform(0.34, 1.9, 0.42),
      widthRatio: 0.8,
      heightRatio: 1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.22, tip2: -0.22, z0: -0.42, z1: -0.58, z2: -0.58, z3: -0.42, along: 1 },
        // The illicium, arching forward over the head.
        { plane: "vertical", root: 0.1, tip: 0.62, tip2: 0.58, z0: 0.24, z1: 0.52, z2: 0.6, z3: 0.3, along: 0.1 },
      ],
    }),
  // Myctophid. Blunt head, forked tail, and photophores in species-specific rows
  // along the belly. The most abundant vertebrate on Earth, and the reason the
  // twilight zone is not empty.
  lanternfish: () =>
    bodyGeometry({
      lengthSegments: 13,
      profile: fusiform(0.7, 1.35, 0.27),
      widthRatio: 0.42,
      heightRatio: 1.1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
      ],
    }),
  // A deep-water ambush predator built almost entirely of jaw: an oversized
  // gape and needle teeth on a slim body, the forked tail and second dorsal
  // shared with lanternfish, plus a single dorsal-lure fin reusing the
  // anglerfish illicium's own trick — thinner, since a viperfish's lure is a
  // filament, not a rod.
  viperfish: () =>
    bodyGeometry({
      lengthSegments: 17,
      profile: fusiform(0.55, 1.7, 0.22),
      widthRatio: 0.3,
      heightRatio: 0.95,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
        { plane: "vertical", root: 0.04, tip: 0.5, tip2: 0.46, z0: 0.3, z1: 0.42, z2: 0.48, z3: 0.34, along: 0.08 },
      ],
    }),
  // The same ambush silhouette as the viperfish, with the lure moved to a
  // barbel hanging FROM THE CHIN rather than a rod over the head — the quad
  // builder makes no sign assumption on a fin's tip, so a negative tip simply
  // hangs the blade downward instead of raising it.
  dragonfish: () =>
    bodyGeometry({
      lengthSegments: 17,
      profile: fusiform(0.5, 1.6, 0.2),
      widthRatio: 0.28,
      heightRatio: 0.9,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
        { plane: "vertical", root: 0.03, tip: -0.55, tip2: -0.5, z0: 0.32, z1: -0.05, z2: -0.15, z3: 0.28, along: 0.06 },
      ],
    }),
  // Almost all head — the profile peaks at t ~ 0.09, a short stubby body with
  // no lure and only a small tail. No other archetype here is this front-heavy.
  fangtooth: () =>
    bodyGeometry({
      lengthSegments: 11,
      profile: fusiform(0.22, 2.3, 0.5),
      widthRatio: 0.6,
      heightRatio: 0.85,
      fins: [{ plane: "vertical", root: 0, tip: 0.3, tip2: -0.3, z0: -0.4, z1: -0.5, z2: -0.5, z3: -0.4, along: 1 }],
    }),
  // The gape sits almost exactly at the nose (peak at t ~ 0.036) and tapers
  // into a long thin whip — more length segments than any other archetype so
  // the travelling wave has room to look smooth over that much body.
  gulperEel: () =>
    bodyGeometry({
      lengthSegments: 24,
      radialSegments: 8,
      profile: fusiform(0.12, 3.2, 0.46),
      widthRatio: 0.5,
      heightRatio: 0.9,
      fins: [{ plane: "vertical", root: 0, tip: 0.18, tip2: -0.18, z0: -0.44, z1: -0.5, z2: -0.5, z3: -0.44, along: 1 }],
    }),
  // The "hatchet blade" silhouette: taller than any other archetype here
  // (heightRatio 1.9, against reefFish's 1.25), carrying the same ventral
  // photophore rows as the lanternfish.
  hatchetfish: () =>
    bodyGeometry({
      lengthSegments: 11,
      profile: fusiform(0.58, 1.9, 0.34),
      widthRatio: 0.22,
      heightRatio: 1.9,
      fins: [{ plane: "vertical", root: 0, tip: 0.3, tip2: -0.3, z0: -0.42, z1: -0.62, z2: -0.62, z3: -0.42, along: 1 }],
    }),
  // The giant oarfish: extreme lateral compression (widthRatio 0.08 — the
  // whole point) and a continuous "mane" dorsal crest running nearly the full
  // body, tallest near the head and settling to a low ridge by the tail —
  // built as a run of small picket fins rather than one or two hand-placed
  // ones, since no single quad can carry a continuously-varying crest height.
  // No caudal fin: a real oarfish has none.
  ribbon: () => {
    const maneFins: Fin[] = [];
    const picketCount = 16;
    for (let i = 0; i < picketCount; i += 1) {
      const along = i / (picketCount - 1);
      const z = 0.5 - along;
      const crestHeight = 0.35 * Math.exp(-along * 2.2) + 0.04;
      const halfWidth = 0.04;
      maneFins.push({
        plane: "vertical",
        root: 0,
        tip: crestHeight,
        tip2: crestHeight,
        z0: z + halfWidth,
        z1: z + halfWidth,
        z2: z - halfWidth,
        z3: z - halfWidth,
        along,
      });
    }
    return bodyGeometry({
      lengthSegments: 28,
      radialSegments: 8,
      profile: fusiform(0.35, 1.15, 0.5),
      widthRatio: 0.08,
      heightRatio: 0.9,
      fins: maneFins,
    });
  },
  // The giant isopod's real segmented, flattened carapace IS a body of
  // revolution after all, once the radius is allowed to step rather than
  // flow smoothly along t: seven overlapping tergite plates, each a slight
  // outward flare followed by a step back in, the same way real pill-bug
  // plates overlap shingle-fashion toward the tail. This replaced an earlier,
  // purely-textured version (a smooth body with painted-on dark seams —
  // see FaunaSpecies.bands, kept as a secondary cue) after the BA report
  // flagged that a "deliberately cheap stand-in" was worth actually fixing.
  // A SYMMETRIC base profile — equal shoulder/taper, unlike every fish
  // archetype above which pinches to a point only at the tail — still gives
  // a body blunt at both ends instead of tapering to a fish-like tail,
  // flattened top-to-bottom (heightRatio 0.45) rather than side-to-side. No
  // fins: an isopod has none large enough to read at this scale.
  isopod: () => {
    const plates = 7;
    const base = fusiform(1.0, 1.0, 0.55);
    return bodyGeometry({
      lengthSegments: plates * 3,
      radialSegments: 12,
      profile: (t) => {
        // Each plate spans 1/plates of the body; within a plate the radius
        // flares slightly outward then steps back in just before the next
        // plate's leading edge overlaps it — a triangular ramp, not a smooth
        // sine, so the boundary reads as a discrete step at this scale
        // rather than a ripple.
        const withinPlate = (t * plates) % 1;
        const flare = 1 + 0.09 * (withinPlate < 0.7 ? withinPlate / 0.7 : 1 - (withinPlate - 0.7) / 0.3);
        return base(t) * flare;
      },
      widthRatio: 0.85,
      heightRatio: 0.45,
    });
  },
  // Giant squid: the full ten-limbed crown — eight arms spread the whole way
  // around plus the two long feeding tentacles that are the family's
  // signature.
  decapod: () => buildCephalopod({ armCount: 8, armArcRadians: Math.PI * 2, longTentacles: true }),
  // Vampire squid: eight arms only (no long tentacles — it has none), spread
  // over a narrower arc so their bases crowd together, approximating the
  // real animal's webbed "cape".
  octopod: () => buildCephalopod({ armCount: 8, armArcRadians: (300 * Math.PI) / 180, longTentacles: false }),
  // A sea turtle: unlike the cephalopods and the seahorse below, the shell IS
  // an ordinary body of revolution — wide, low (heightRatio 0.32) and
  // symmetric-ish rather than fish-tapered — so no new construction was
  // actually needed, just a different profile/fin arrangement, the same way
  // every Bucket A/B species this rig already carries is one. The four
  // flippers reuse the existing horizontal-fin quad (already a paired,
  // symmetric shape from a single quad — see bodyGeometry's `quad` helper):
  // large front flippers near the head, smaller rear flippers near the tail.
  turtle: () =>
    bodyGeometry({
      lengthSegments: 16,
      radialSegments: 12,
      // A small forward head/neck bump (constant term) riding a wide, flat
      // shell dome that peaks just past the head — real carapace proportions.
      profile: (t) => 0.14 * Math.exp(-t * 7) + fusiform(0.55, 1.35, 0.62)(t),
      widthRatio: 0.92,
      heightRatio: 0.32,
      fins: [
        { plane: "horizontal", root: 0.05, tip: 0.62, z0: 0.2, z1: 0.02, along: 0.26 },
        { plane: "horizontal", root: 0.04, tip: 0.32, z0: -0.18, z1: -0.3, along: 0.74 },
      ],
    }),
  // A seahorse: see buildSeahorse above for why the curling body plan a plan
  // once deferred as "not fitting a Z-axis revolve" splits cleanly into a
  // small ordinary revolve (the head) and the existing curving-tube
  // construction (the trunk and prehensile tail) already built for
  // cephalopod arms.
  seahorse: () => buildSeahorse(),
};

const cache = new Map<BodyArchetype, BufferGeometry>();

/**
 * One geometry per archetype, cloned per school.
 *
 * Cached because fourteen schools draw from seven shapes, and cloned because
 * `normaliseModel` and the adopt path both mutate what they are handed.
 */
export function bodyForArchetype(archetype: BodyArchetype): BufferGeometry {
  const existing = cache.get(archetype);
  if (existing) return existing.clone();
  const built = BUILDERS[archetype]();
  cache.set(archetype, built);
  return built.clone();
}
