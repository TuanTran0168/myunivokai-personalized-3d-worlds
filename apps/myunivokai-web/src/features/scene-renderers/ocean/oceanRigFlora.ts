/**
 * What grows on the floor: kelp and seagrass blades, and barrel sponges.
 *
 * Two rules decide what appears, and both are biology rather than art
 * direction:
 *
 *   - **Algae are photosynthetic, so they stop where the light does.** Kelp
 *     forests live in the top few tens of metres and are gone well before the
 *     twilight zone; putting a kelp bed on an abyssal plain is the same
 *     category of error as putting a fish above the waterline. The cutoff here
 *     is driven by the water's own optics, not by a depth constant, so clear
 *     open ocean grows kelp deeper than an estuary does — which is exactly what
 *     happens in the sea.
 *   - **Sponges are heterotrophs and do not care.** They filter feed, so they
 *     go all the way down, and below the photic zone they are the only
 *     structure left. That matters visually as well as biologically: a reef
 *     built only from blades has no MASS in it, and the deep would otherwise
 *     have nothing standing on it at all.
 *
 * Everything stands on the rig's OWN floor sampler. Anything that samples a
 * different height function hovers or sinks, which is the single most common
 * bug this scene has produced.
 */
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import { randomFromSeed } from "@/lib/scene";
import { applyCaustics, type CausticsUniforms } from "./oceanCaustics";

export type SwayUniforms = {
  uSwayTime: { value: number };
  uCurrent: { value: Vector2 };
};

export function createSwayUniforms(currentStrength: number): SwayUniforms {
  return {
    uSwayTime: { value: 0 },
    uCurrent: { value: new Vector2(0.55, 0.2).multiplyScalar(currentStrength) },
  };
}

// Kelp/sponge radii used to start at 0, unlike the boulders in
// oceanRigTerrain.ts (BOULDER_CAMERA_STANDOFF_METRES): a bed or a sponge could
// land at or near the world origin, inside the camera's own orbit radius, and
// a kelp blade rooted a few metres from the lens fills the frame at point-blank
// range while its base is too close to read — reported as "a tree growing out
// of nowhere". Same fix, same standoff distance as the boulders it sits beside.
const FLORA_CAMERA_STANDOFF_METRES = 6;

/** Uniform-density sample of a radius in [inner, outer), never [0, outer). */
function radiusBeyond(random: () => number, inner: number, outer: number): number {
  if (outer <= inner) {
    return inner;
  }
  return Math.sqrt(inner * inner + random() * (outer * outer - inner * inner));
}

/**
 * The depth at which algae give up, in metres.
 *
 * Kelp needs roughly 1% of surface irradiance to hold a net carbon gain, which
 * is the same 1% depth the optics module already computes for blue light. Real
 * kelp forests bottom out shallower than that — they are limited by more than
 * light — so this takes a fraction of it, and the fraction is the only fitted
 * number in the file.
 */
export function algaeDepthLimitMetres(onePercentBlueDepthMetres: number): number {
  return Math.min(70, onePercentBlueDepthMetres * 0.55);
}

type BladeOptions = {
  count: number;
  seedName: string;
  heightBase: number;
  heightRange: number;
  radiusOuter: number;
  /** No bed's own centre may land closer to the origin than this. */
  radiusInner: number;
  color: string;
  heightAt: (x: number, z: number) => number;
  sway: SwayUniforms;
};

/**
 * A bed of blades.
 *
 * The blade is a 14-segment plane bent into a leaf: widest around a third of
 * its length, pointed at the tip, arcing at rest. A straight one-segment
 * rectangle is the "stick" read, and no amount of sway animation hides it.
 *
 * They are placed in TUFTS from shared holdfasts, because that is how kelp and
 * seagrass actually grow — one blade per anchor is the geometric definition of
 * a stick.
 */
function createBladeBed(options: BladeOptions): InstancedMesh {
  const { count, seedName, heightBase, heightRange, radiusOuter, radiusInner, color, heightAt, sway } = options;

  const blade = new PlaneGeometry(1, 1, 1, 14);
  blade.translate(0, 0.5, 0);
  const bladePositions = blade.getAttribute("position");
  for (let i = 0; i < bladePositions.count; i += 1) {
    const t = Math.min(1, Math.max(0, bladePositions.getY(i)));
    bladePositions.setX(i, bladePositions.getX(i) * (Math.sin(Math.PI * Math.pow(t, 0.48)) * 0.92 + 0.08));
    bladePositions.setZ(i, t * t * 0.28);
  }
  bladePositions.needsUpdate = true;
  blade.computeVertexNormals();

  const material = new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sway);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
          uniform float uSwayTime; uniform vec2 uCurrent;
          attribute float aSwayPhase;
          varying float vHeightFraction; varying float vPlantTone;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          vHeightFraction = clamp(position.y, 0.0, 1.0);
          vPlantTone = 0.72 + 0.56 * fract(sin(aSwayPhase * 12.9898) * 43758.5453);
          // Quadratic envelope: anchored at the base, free at the tip. A linear
          // ramp makes the whole plant slide instead of bend.
          float bend = vHeightFraction * vHeightFraction;
          transformed.x += sin(uSwayTime * 1.15 + aSwayPhase + vHeightFraction * 2.4) * bend * 0.34;
          transformed.z += cos(uSwayTime * 0.83 + aSwayPhase * 1.7) * bend * 0.24;
          transformed.xz += uCurrent * bend * 0.5;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vHeightFraction;\nvarying float vPlantTone;",
      )
      // Darkest at the ground — the contact shadow that stops vegetation
      // floating — brightest at the tip, where a translucent blade really does
      // catch the light.
      .replace(
        "#include <tonemapping_fragment>",
        "gl_FragColor.rgb *= mix(0.16, 1.32, smoothstep(0.0, 0.8, vHeightFraction)) * vPlantTone;\n#include <tonemapping_fragment>",
      );
  };

  const mesh = new InstancedMesh(blade, material, count);
  const next = randomFromSeed(seedName);
  // Bed radius drawn BEFORE the bed's own centre distance, because the centre
  // must clear the standoff by at least its own radius — a bed whose centre
  // just barely clears radiusInner but whose r is large still scatters blades
  // back inside it, which is the same bug at one remove.
  const beds: { x: number; z: number; r: number }[] = [];
  const effectiveOuter = radiusOuter * 0.86;
  for (let i = 0; i < 16; i += 1) {
    const angle = next() * Math.PI * 2;
    const bedRadius = radiusOuter * (0.05 + next() * 0.16);
    const centreRadius = radiusBeyond(next, radiusInner + bedRadius, effectiveOuter);
    beds.push({
      x: Math.cos(angle) * centreRadius,
      z: Math.sin(angle) * centreRadius,
      r: bedRadius,
    });
  }

  const phases = new Float32Array(count);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const position = new Vector3();
  const scale = new Vector3();

  let written = 0;
  while (written < count) {
    const pick = next() * beds.length;
    const bed = beds[Math.min(beds.length - 1, Math.floor(pick))];
    const local = (pick - Math.floor(pick)) * Math.PI * 2;
    const localRadius = Math.sqrt(next()) * bed.r;
    const tuftX = bed.x + Math.cos(local) * localRadius;
    const tuftZ = bed.z + Math.sin(local) * localRadius;
    const tuftHeight = heightBase + next() * heightRange;
    const tuftYaw = next() * Math.PI * 2;
    const blades = Math.min(count - written, 3 + Math.floor(next() * 5));
    for (let b = 0; b < blades; b += 1) {
      const spread = tuftHeight * 0.13;
      const x = tuftX + (next() - 0.5) * spread;
      const z = tuftZ + (next() - 0.5) * spread;
      const height = tuftHeight * (0.62 + next() * 0.55);
      euler.set((next() - 0.5) * 0.5, tuftYaw + (next() - 0.5) * 1.9, (next() - 0.5) * 0.55);
      quaternion.setFromEuler(euler);
      position.set(x, heightAt(x, z) - 0.1, z);
      scale.set(height * (0.055 + next() * 0.05), height, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(written, matrix);
      phases[written] = next() * Math.PI * 2;
      written += 1;
    }
  }
  blade.setAttribute("aSwayPhase", new InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  mesh.instanceMatrix.needsUpdate = true;
  // Deliberately NOT a shadow receiver. A blade is one quad thick and it moves
  // every frame in the vertex shader, which the shadow pass does not follow —
  // so it shadow-acnes against itself and the near-field kelp renders as black
  // spikes. The blade already carries its own base-to-tip gradient, which is
  // the shading a real one has.
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}

type SpongeOptions = {
  count: number;
  seedName: string;
  radiusOuter: number;
  radiusInner: number;
  heightAt: (x: number, z: number) => number;
  caustics: CausticsUniforms;
  castShadow: boolean;
};

/**
 * Barrel and tube sponges — the only reef organism here with a BULK
 * silhouette, and the only one that belongs at every depth.
 *
 * Lumpy and flared at the osculum: a perfect cylinder is the other half of the
 * placeholder read that the straight blade was the first half of.
 */
function createSpongeField(options: SpongeOptions): InstancedMesh {
  const { count, seedName, radiusOuter, radiusInner, heightAt, caustics, castShadow } = options;
  const geometry = new CylinderGeometry(0.44, 0.4, 1, 14, 4, false);
  geometry.translate(0, 0.5, 0);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const lump = 1 + 0.19 * Math.sin(Math.atan2(z, x) * 5 + y * 3.4) + 0.11 * Math.sin(y * 7);
    // Widest a third of the way up, and never flared at the rim.
    const barrel = 0.72 + 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, y)) * 0.85);
    positions.setX(i, x * lump * barrel);
    positions.setZ(i, z * lump * barrel);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new MeshStandardMaterial({
    color: new Color("#C7A681"),
    roughness: 0.95,
    metalness: 0,
  });
  applyCaustics(material, caustics);

  const mesh = new InstancedMesh(geometry, material, count);
  const next = randomFromSeed(seedName);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const position = new Vector3();
  const scale = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const angle = next() * Math.PI * 2;
    const radius = radiusBeyond(next, radiusInner, radiusOuter);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 0.4 + next() * 1.15;
    euler.set((next() - 0.5) * 0.22, next() * Math.PI * 2, (next() - 0.5) * 0.22);
    quaternion.setFromEuler(euler);
    position.set(x, heightAt(x, z) - 0.1, z);
    const girth = height * (0.72 + next() * 0.5);
    scale.set(girth, height, girth);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.frustumCulled = false;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

export type FloraOptions = {
  seed: string;
  /** How far out from the viewer the floor is dressed. */
  basinRadius: number;
  /** The camera's own orbit radius, so flora never scatters inside it. */
  cameraDistanceMetres: number;
  /** Depth of the FLOOR, which is what plants live at — not the viewer's. */
  floorDepthMetres: number;
  /** From the optics module, so clear water grows kelp deeper than an estuary. */
  onePercentBlueDepthMetres: number;
  /** The rig's own floor sampler. Anything else hovers. */
  heightAt: (x: number, z: number) => number;
  caustics: CausticsUniforms;
  currentStrength: number;
  quality: "high" | "low";
};

export type Flora = {
  group: Group;
  sway: SwayUniforms;
  /** Exposed so the rig can give them the same tone curve as the water. */
  materials: MeshStandardMaterial[];
  /** Which of the two guilds actually grew here, for the state readout. */
  present: string[];
  tint: (water: Color, brightness: number) => void;
  update: (elapsed: number) => void;
  dispose: () => void;
};

export function createFlora(options: FloraOptions): Flora {
  const {
    seed,
    basinRadius,
    cameraDistanceMetres,
    floorDepthMetres,
    onePercentBlueDepthMetres,
    heightAt,
    caustics,
    currentStrength,
    quality,
  } = options;
  const high = quality === "high";
  const group = new Group();
  const sway = createSwayUniforms(currentStrength);
  const present: string[] = [];
  const meshes: InstancedMesh[] = [];
  const radiusInner = cameraDistanceMetres + FLORA_CAMERA_STANDOFF_METRES;

  const algaeLimit = algaeDepthLimitMetres(onePercentBlueDepthMetres);
  // Fades out over the last third rather than switching off at a line: a hard
  // edge on a biological limit is the one thing that never happens in the sea.
  const algaeDensity = Math.min(1, Math.max(0, (algaeLimit - floorDepthMetres) / (algaeLimit * 0.34)));

  if (algaeDensity > 0.02) {
    const canopyCount = Math.round((high ? 3000 : 1100) * algaeDensity);
    const turfCount = Math.round((high ? 3200 : 1200) * algaeDensity);
    if (canopyCount > 24) {
      meshes.push(
        createBladeBed({
          count: canopyCount,
          seedName: `${seed}:kelp-canopy`,
          heightBase: 1.9,
          heightRange: 3.2,
          radiusOuter: basinRadius * 0.42,
          radiusInner,
          color: "#4E9463",
          heightAt,
          sway,
        }),
      );
    }
    if (turfCount > 24) {
      meshes.push(
        createBladeBed({
          count: turfCount,
          seedName: `${seed}:kelp-turf`,
          heightBase: 0.45,
          heightRange: 1.0,
          radiusOuter: basinRadius * 0.5,
          radiusInner,
          color: "#63A971",
          heightAt,
          sway,
        }),
      );
    }
    if (meshes.length > 0) present.push("kelp");
  }

  // Sponges everywhere, and MORE of them where the algae have gone, because
  // that is what actually happens: filter feeders inherit the floor.
  const spongeCount = Math.round((high ? 150 : 70) * (1 + (1 - algaeDensity) * 0.9));
  const sponges = createSpongeField({
    count: spongeCount,
    seedName: `${seed}:sponge-field`,
    radiusOuter: basinRadius * 0.34,
    radiusInner,
    heightAt,
    caustics,
    castShadow: high,
  });
  meshes.push(sponges);
  present.push("sponges");

  for (const mesh of meshes) group.add(mesh);

  const bladeMaterials = meshes
    .map((mesh) => mesh.material)
    .filter((material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial);
  const baseColors = bladeMaterials.map((material) => material.color.clone());

  return {
    group,
    sway,
    present,
    materials: bladeMaterials,
    // Plants are in the water like everything else: they take the water's
    // colour the less sun there is, on exactly the terms the seabed does.
    tint: (water, brightness) => {
      bladeMaterials.forEach((material, index) => {
        material.color
          .copy(baseColors[index])
          .lerp(water, 0.3 + (1 - brightness) * 0.45)
          .multiplyScalar(0.66 + brightness * 0.26);
      });
    },
    update: (elapsed) => {
      sway.uSwayTime.value = elapsed;
    },
    dispose: () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
    },
  };
}
