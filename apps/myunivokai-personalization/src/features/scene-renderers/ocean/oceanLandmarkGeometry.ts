/**
 * The landmarks, built rather than imported.
 *
 * # Why this file exists
 *
 * The ocean's landmarks were forest models, chosen by silhouette and defended
 * in a comment: "a bare dead tree and a staghorn coral are the same shape". On
 * screen they are not. The kelp cathedral was `tree-dead-2.glb` and read as a
 * dead tree standing on the seabed; the sunken relic was
 * `landmark-lantern-shrine.glb` and read as a STREET LAMP, underwater, with a
 * lantern on it. Nothing about tinting or scaling fixes an object whose
 * silhouette already says "land".
 *
 * The prototype this family is modelled on imports no props at all — its rocks,
 * its sponges and its kelp are geometry, built from the shapes those things
 * actually have. That is what is here. A landmark is the one object a visitor
 * is invited to click, so it is the last place a borrowed asset can hide.
 *
 * # What each shape is
 *
 * Every builder is a real seabed feature, and the shape comes from what makes
 * that feature recognisable rather than from what is easy to build:
 *
 *   hydrothermalVent  a black smoker — stacked mineral chimneys, leaning,
 *                     crusted pale where sulphides precipitate
 *   abyssalTrench     a rock pinnacle with talus at its foot
 *   coralGarden       a massive coral head with staghorn branching off it
 *   kelpCathedral     a stand of stipes rising into a canopy of blades
 *   whaleFall         a vertebral column and rib arcs, half in the sediment
 *   sunkenRelic       the one landmark that must read as MADE: a hull section,
 *                     ribs and keel, canted where it settled
 *
 * Each returns geometry with its FOOT AT y = 0 and scaled to a stated height,
 * so a landmark stands on the sediment instead of hovering over it — and it
 * carries per-part colour as a vertex attribute, so one material draws the
 * whole thing and two landmarks of one kind can still be tinted apart.
 */
import {
  BufferGeometry,
  Box3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  SphereGeometry,
  Euler,
  Quaternion,
  Vector3,
} from "three";
import { randomFromSeed } from "@/lib/scene";

type Part = { geometry: BufferGeometry; color: Color };

/** Basalt, mineral crust, living tissue, bone, corroded iron. */
const BASALT = new Color("#38393D");
const SULPHIDE_CRUST = new Color("#9A8B72");
const STONE = new Color("#6E6A62");
const CORAL_BODY = new Color("#C08D74");
const CORAL_BRANCH = new Color("#D8B79A");
const KELP_STIPE = new Color("#5E7248");
const KELP_BLADE = new Color("#4E9463");
const BONE = new Color("#CFC7B4");
const CORRODED_IRON = new Color("#5A5348");

function place(
  geometry: BufferGeometry,
  position: Vector3,
  rotation: Euler,
  scale: Vector3,
): BufferGeometry {
  const matrix = new Matrix4().compose(position, new Quaternion().setFromEuler(rotation), scale);
  return geometry.clone().applyMatrix4(matrix);
}

/**
 * Merge into one non-indexed geometry carrying per-part colour.
 *
 * Non-indexed on purpose: these are faceted rock and bone, and sharing vertices
 * between faces would average their normals into a soft blob. The facets ARE
 * the read.
 */
function mergeParts(parts: Part[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const sourcePosition = source.getAttribute("position");
    const sourceNormal = source.getAttribute("normal");
    for (let i = 0; i < sourcePosition.count; i += 1) {
      positions.push(sourcePosition.getX(i), sourcePosition.getY(i), sourcePosition.getZ(i));
      normals.push(sourceNormal.getX(i), sourceNormal.getY(i), sourceNormal.getZ(i));
      colors.push(part.color.r, part.color.g, part.color.b);
    }
    if (source !== part.geometry) source.dispose();
    part.geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  merged.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return merged;
}

/** Foot on the ground, centred in x/z, scaled so the tallest point is `height`. */
function standOn(geometry: BufferGeometry, height: number): BufferGeometry {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new Box3();
  const size = new Vector3();
  bounds.getSize(size);
  const scale = size.y > 1e-4 ? height / size.y : 1;
  geometry.translate(
    -(bounds.min.x + bounds.max.x) / 2,
    -bounds.min.y,
    -(bounds.min.z + bounds.max.z) / 2,
  );
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingSphere();
  // Recomputed AFTER the transform, so `boundingBox` describes the shape as it
  // will be drawn rather than as it was built. landmarkFootprintRadiusMetres
  // reads it to decide how wide a patch of seabed the shape has to stand on.
  geometry.computeBoundingBox();
  return geometry;
}

/** Roughen a geometry's vertices so nothing reads as a primitive. */
function roughen(geometry: BufferGeometry, amount: number, next: () => number): BufferGeometry {
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(
      i,
      position.getX(i) + (next() - 0.5) * amount,
      position.getY(i) + (next() - 0.5) * amount,
      position.getZ(i) + (next() - 0.5) * amount,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildHydrothermalVent(next: () => number): Part[] {
  const parts: Part[] = [];
  // A black smoker grows as stacked chimneys, each leaning off the last —
  // straight stacking is the placeholder read.
  let y = 0;
  let lean = 0;
  let radius = 0.62;
  for (let segment = 0; segment < 4; segment += 1) {
    const height = 0.9 + next() * 0.8;
    const top = radius * (0.62 + next() * 0.2);
    lean += (next() - 0.5) * 0.34;
    parts.push({
      geometry: roughen(
        place(
          new CylinderGeometry(top, radius, height, 9, 2),
          new Vector3(Math.sin(lean) * height * 0.4, y + height / 2, Math.cos(lean) * height * 0.12),
          new Euler(0, next() * Math.PI, lean * 0.5),
          new Vector3(1, 1, 1),
        ),
        0.09,
        next,
      ),
      // Crusted pale toward the top, where sulphides precipitate out of the
      // plume; basalt-dark at the base.
      color: BASALT.clone().lerp(SULPHIDE_CRUST, segment / 4),
    });
    y += height * 0.86;
    radius = top;
  }
  // Talus of collapsed chimney at the foot. A vent field is mostly rubble.
  for (let i = 0; i < 7; i += 1) {
    const angle = next() * Math.PI * 2;
    const distance = 0.7 + next() * 0.9;
    const size = 0.16 + next() * 0.24;
    parts.push({
      geometry: roughen(
        place(
          new IcosahedronGeometry(size, 0),
          new Vector3(Math.cos(angle) * distance, size * 0.5, Math.sin(angle) * distance),
          new Euler(next() * 3, next() * 3, next() * 3),
          new Vector3(1, 0.7, 1),
        ),
        0.05,
        next,
      ),
      color: BASALT.clone().lerp(STONE, next() * 0.5),
    });
  }
  return parts;
}

function buildRockPinnacle(next: () => number): Part[] {
  const parts: Part[] = [];
  // A pinnacle is a stack of increasingly small slabs, not a cone: the steps
  // are where a viewer reads its height from.
  let y = 0;
  let radius = 1.0;
  for (let tier = 0; tier < 5; tier += 1) {
    const height = 0.7 + next() * 0.7;
    parts.push({
      geometry: roughen(
        place(
          new CylinderGeometry(radius * 0.68, radius, height, 7, 1),
          new Vector3((next() - 0.5) * 0.22, y + height / 2, (next() - 0.5) * 0.22),
          new Euler((next() - 0.5) * 0.14, next() * Math.PI, (next() - 0.5) * 0.14),
          new Vector3(1, 1, 0.86 + next() * 0.28),
        ),
        0.16,
        next,
      ),
      color: STONE.clone().multiplyScalar(0.78 + next() * 0.34),
    });
    y += height * 0.92;
    radius *= 0.72;
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = next() * Math.PI * 2;
    const distance = 0.9 + next() * 0.8;
    const size = 0.2 + next() * 0.3;
    parts.push({
      geometry: roughen(
        place(
          new IcosahedronGeometry(size, 0),
          new Vector3(Math.cos(angle) * distance, size * 0.45, Math.sin(angle) * distance),
          new Euler(next() * 3, next() * 3, next() * 3),
          new Vector3(1, 0.62, 1),
        ),
        0.06,
        next,
      ),
      color: STONE.clone().multiplyScalar(0.7 + next() * 0.3),
    });
  }
  return parts;
}

function buildCoralGarden(next: () => number): Part[] {
  const parts: Part[] = [];
  // The massive head first: a coral garden without one bulk form is a handful
  // of sticks.
  parts.push({
    geometry: roughen(
      place(
        new SphereGeometry(1.0, 12, 9),
        new Vector3(0, 0.62, 0),
        new Euler(0, next() * Math.PI, 0),
        new Vector3(1.25, 0.78, 1.1),
      ),
      0.14,
      next,
    ),
    color: CORAL_BODY.clone(),
  });
  // Staghorn: forking branches, each fork thinner and shorter than its parent.
  const branch = (
    origin: Vector3,
    direction: Vector3,
    thickness: number,
    length: number,
    depth: number,
  ) => {
    if (depth > 3 || thickness < 0.03) return;
    const end = origin.clone().addScaledVector(direction, length);
    const mid = origin.clone().lerp(end, 0.5);
    const orientation = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    const matrix = new Matrix4().compose(mid, orientation, new Vector3(1, 1, 1));
    parts.push({
      geometry: new CylinderGeometry(thickness * 0.7, thickness, length, 6, 1).applyMatrix4(matrix),
      color: CORAL_BRANCH.clone().lerp(CORAL_BODY, depth / 4),
    });
    const forks = 2 + Math.floor(next() * 2);
    for (let i = 0; i < forks; i += 1) {
      const spread = new Vector3(
        direction.x + (next() - 0.5) * 1.3,
        direction.y + next() * 0.5,
        direction.z + (next() - 0.5) * 1.3,
      ).normalize();
      branch(end, spread, thickness * 0.68, length * (0.62 + next() * 0.22), depth + 1);
    }
  };
  const stems = 4 + Math.floor(next() * 3);
  for (let i = 0; i < stems; i += 1) {
    const angle = (i / stems) * Math.PI * 2 + next() * 0.6;
    const start = new Vector3(Math.cos(angle) * 0.72, 0.9, Math.sin(angle) * 0.66);
    branch(
      start,
      new Vector3(Math.cos(angle) * 0.5, 1, Math.sin(angle) * 0.5).normalize(),
      0.11,
      0.6 + next() * 0.4,
      0,
    );
  }
  return parts;
}

function buildKelpCathedral(next: () => number): Part[] {
  const parts: Part[] = [];
  const stipes = 6 + Math.floor(next() * 4);
  for (let i = 0; i < stipes; i += 1) {
    const angle = (i / stipes) * Math.PI * 2 + next() * 0.5;
    const radius = 0.3 + next() * 0.75;
    const height = 3.4 + next() * 2.2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // A stipe leans with the current and tapers hard: at constant thickness it
    // is a column, and a column is architecture rather than an alga.
    const lean = 0.1 + next() * 0.22;
    parts.push({
      geometry: place(
        new CylinderGeometry(0.035, 0.1, height, 6, 1),
        new Vector3(x + lean * height * 0.16, height / 2, z),
        new Euler(0, next() * Math.PI, lean),
        new Vector3(1, 1, 1),
      ),
      color: KELP_STIPE.clone().multiplyScalar(0.8 + next() * 0.4),
    });
    // Blades ride the upper half, where a real frond carries them.
    const blades = 4 + Math.floor(next() * 4);
    for (let b = 0; b < blades; b += 1) {
      const along = 0.42 + next() * 0.55;
      const bladeY = height * along;
      const bladeAngle = next() * Math.PI * 2;
      parts.push({
        geometry: place(
          new SphereGeometry(0.5, 6, 4),
          new Vector3(
            x + lean * bladeY * 0.32 + Math.cos(bladeAngle) * 0.34,
            bladeY,
            z + Math.sin(bladeAngle) * 0.34,
          ),
          new Euler((next() - 0.5) * 0.6, bladeAngle, (next() - 0.5) * 0.9),
          new Vector3(0.62 + next() * 0.3, 0.09, 0.16),
        ),
        color: KELP_BLADE.clone().multiplyScalar(0.78 + next() * 0.45),
      });
    }
  }
  return parts;
}

function buildWhaleFall(next: () => number): Part[] {
  const parts: Part[] = [];
  const length = 5.2;
  // The vertebral column, sagging where it settled.
  const vertebrae = 16;
  for (let i = 0; i < vertebrae; i += 1) {
    const t = i / (vertebrae - 1);
    const z = (t - 0.5) * length;
    const sag = Math.sin(t * Math.PI) * 0.22;
    const girth = 0.3 * (1 - Math.abs(t - 0.35) * 0.9);
    parts.push({
      geometry: place(
        new CylinderGeometry(Math.max(0.05, girth), Math.max(0.05, girth * 1.1), 0.26, 7, 1),
        new Vector3((next() - 0.5) * 0.06, 0.42 + sag, z),
        new Euler(Math.PI / 2, 0, (next() - 0.5) * 0.2),
        new Vector3(1, 1, 1),
      ),
      color: BONE.clone().multiplyScalar(0.82 + next() * 0.3),
    });
  }
  // Rib arcs, springing from the front two thirds and fanning outward. A whale
  // fall with no ribs is a log, which is precisely what the old asset was.
  const ribs = 9;
  for (let i = 0; i < ribs; i += 1) {
    const t = i / (ribs - 1);
    const z = (t - 0.62) * length * 0.72;
    const span = 1.5 * Math.sin((0.25 + t * 0.7) * Math.PI);
    for (const side of [-1, 1]) {
      const segments = 5;
      for (let segment = 0; segment < segments; segment += 1) {
        const phase = segment / segments;
        const nextPhase = (segment + 1) / segments;
        const angleFrom = phase * Math.PI * 0.62;
        const angleTo = nextPhase * Math.PI * 0.62;
        const from = new Vector3(
          side * Math.sin(angleFrom) * span,
          0.42 + Math.cos(angleFrom) * span * 0.72,
          z,
        );
        const to = new Vector3(
          side * Math.sin(angleTo) * span,
          0.42 + Math.cos(angleTo) * span * 0.72,
          z,
        );
        const mid = from.clone().lerp(to, 0.5);
        const direction = to.clone().sub(from);
        const orientation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          direction.clone().normalize(),
        );
        parts.push({
          geometry: new CylinderGeometry(0.05, 0.06, direction.length() * 1.04, 5, 1).applyMatrix4(
            new Matrix4().compose(mid, orientation, new Vector3(1, 1, 1)),
          ),
          color: BONE.clone().multiplyScalar(0.7 + next() * 0.35),
        });
      }
    }
  }
  return parts;
}

function buildSunkenRelic(next: () => number): Part[] {
  const parts: Part[] = [];
  // The one landmark that must read as MADE. Architecture is straight lines,
  // repetition and right angles — none of which the sea produces — so the shape
  // is a hull section: a keel beam, evenly spaced frames, and a canted plate.
  const length = 4.6;
  const cant = 0.26;
  parts.push({
    geometry: place(
      new CylinderGeometry(0.16, 0.16, length, 6, 1),
      new Vector3(0, 0.3, 0),
      new Euler(Math.PI / 2, 0, cant),
      new Vector3(1, 1, 1),
    ),
    color: CORRODED_IRON.clone(),
  });
  const frames = 7;
  for (let i = 0; i < frames; i += 1) {
    const t = i / (frames - 1);
    const z = (t - 0.5) * length * 0.88;
    // Evenly spaced and identical: the repetition is the whole signal.
    const span = 1.15 * (0.55 + 0.45 * Math.sin(t * Math.PI));
    for (const side of [-1, 1]) {
      const segments = 4;
      for (let segment = 0; segment < segments; segment += 1) {
        const angleFrom = (segment / segments) * Math.PI * 0.58;
        const angleTo = ((segment + 1) / segments) * Math.PI * 0.58;
        const from = new Vector3(
          side * Math.sin(angleFrom) * span,
          0.3 + Math.cos(angleFrom) * span * 0.9,
          z,
        );
        const to = new Vector3(
          side * Math.sin(angleTo) * span,
          0.3 + Math.cos(angleTo) * span * 0.9,
          z,
        );
        const mid = from.clone().lerp(to, 0.5);
        const direction = to.clone().sub(from);
        parts.push({
          geometry: new CylinderGeometry(0.055, 0.055, direction.length() * 1.05, 5, 1).applyMatrix4(
            new Matrix4().compose(
              mid,
              new Quaternion().setFromUnitVectors(
                new Vector3(0, 1, 0),
                direction.clone().normalize(),
              ),
              new Vector3(1, 1, 1),
            ),
          ),
          color: CORRODED_IRON.clone().multiplyScalar(0.8 + next() * 0.4),
        });
      }
    }
  }
  // A plate of hull still attached, canted where the wreck settled.
  parts.push({
    geometry: place(
      new SphereGeometry(1, 8, 6),
      new Vector3(0.5, 0.9, -0.4),
      new Euler(0.3, 0.5, cant + 0.4),
      new Vector3(0.9, 0.055, 1.5),
    ),
    color: CORRODED_IRON.clone().lerp(STONE, 0.3),
  });
  // Settled into sediment rather than resting on it: a wreck is half buried,
  // and the mound is what says it has been there a long time.
  parts.push({
    geometry: roughen(
      place(
        new SphereGeometry(1, 10, 6),
        new Vector3(0, 0.02, 0),
        new Euler(0, next() * Math.PI, 0),
        new Vector3(1.7, 0.3, 2.6),
      ),
      0.1,
      next,
    ),
    color: STONE.clone().lerp(CORAL_BODY, 0.25),
  });
  return parts;
}

const BUILDERS: Record<string, (next: () => number) => Part[]> = {
  hydrothermalVent: buildHydrothermalVent,
  abyssalTrench: buildRockPinnacle,
  coralGarden: buildCoralGarden,
  kelpCathedral: buildKelpCathedral,
  whaleFall: buildWhaleFall,
  sunkenRelic: buildSunkenRelic,
};

/** How tall each kind stands, in metres. */
export const LANDMARK_HEIGHT_METRES: Record<string, number> = {
  hydrothermalVent: 4.6,
  abyssalTrench: 5.5,
  coralGarden: 3.2,
  kelpCathedral: 6.4,
  // Lying down, so its height is its girth rather than its length.
  whaleFall: 1.8,
  sunkenRelic: 2.6,
};

export const LANDMARK_KINDS = Object.keys(BUILDERS);

const cache = new Map<string, BufferGeometry>();

/**
 * Geometry for a landmark kind, cached per (kind, seed).
 *
 * Seeded so two landmarks of the same kind in one world are not the same
 * object twice — a vent field of identical chimneys reads as instancing, which
 * is the other way a landmark stops looking like a place.
 */
export function landmarkGeometry(kind: string, seed: string): BufferGeometry {
  const resolved = BUILDERS[kind] ? kind : "abyssalTrench";
  const key = `${resolved}:${seed}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const next = randomFromSeed(`${seed}:landmark:${resolved}`);
  const geometry = standOn(
    mergeParts(BUILDERS[resolved](next)),
    LANDMARK_HEIGHT_METRES[resolved] ?? 4,
  );
  cache.set(key, geometry);
  return geometry;
}

/**
 * How far this landmark's shape reaches from its own centre in x and z, in
 * metres — the radius of the patch of seabed it has to stand on.
 *
 * Read from the geometry rather than declared in a table beside
 * LANDMARK_HEIGHT_METRES, because the shapes are seeded: two whale falls are
 * two different whale falls, and a hand-maintained footprint would be right for
 * one of them. The geometry is cached per (kind, seed), so this is a lookup
 * after the first call.
 */
export function landmarkFootprintRadiusMetres(kind: string, seed: string): number {
  const bounds = landmarkGeometry(kind, seed).boundingBox;
  if (!bounds) {
    return 0;
  }
  return Math.max(
    Math.abs(bounds.min.x),
    Math.abs(bounds.max.x),
    Math.abs(bounds.min.z),
    Math.abs(bounds.max.z),
  );
}

/**
 * Each landmark kind's own colour, before the water takes anything out of it.
 *
 * Lives here with the geometry it belongs to. It used to be the single surviving
 * export of `oceanModels.ts`, a 641-line module whose other sixteen exports —
 * procedural flora, fish, drifter, giant and abyss-visitor geometry — were built
 * for the per-species components that were replaced by the rig and were reachable
 * from no code path at all. Keeping 630 dead lines around a live constant is how a
 * reader ends up unsure which of two procedural-geometry modules is the real one.
 */
export const LANDMARK_BASE_COLORS: Record<string, string> = {
  kelpCathedral: "#3F6B37",
  sunkenRelic: "#9AA79B",
  hydrothermalVent: "#2B2622",
  coralGarden: "#D97F5C",
  abyssalTrench: "#2C3440",
  whaleFall: "#D9D3C4",
};
