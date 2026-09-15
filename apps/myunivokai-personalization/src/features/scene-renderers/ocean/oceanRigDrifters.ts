/**
 * What is suspended in the water column: jellyfish, bubble streams, marine snow.
 *
 * # Why these are one module
 *
 * Two of the three depth zones cannot see the seafloor and one cannot see the
 * surface either, so in those worlds nothing standing on anything is in frame.
 * Drifters are the ONLY content those zones can have — and since roughly three
 * quarters of open-ocean animals are bioluminescent, in the dark they are also
 * the only light. A midwater world without them is not a place, it is a coloured
 * rectangle, which is exactly what the app's twilight view rendered as.
 *
 * All three are instanced or point geometry with their motion in the vertex
 * shader, so the whole layer costs one draw call and no per-frame CPU work.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  Object3D,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  type SpriteMaterial,
} from "three";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import { moteLayerBuild, MOTE_SEED_ATTRIBUTE } from "./oceanMoteMaterial";
import {
  bubbleMaterial,
  jellyfishMaterial,
  BUBBLE_ANCHOR_ATTRIBUTE,
  BUBBLE_SEED_ATTRIBUTE,
  JELLYFISH_ANCHOR_ATTRIBUTE,
  JELLYFISH_SEED_ATTRIBUTE,
  type BubbleFrameUniforms,
  type JellyfishFrameUniforms,
} from "./oceanDrifterMaterials";

type Random = () => number;

/* ========================================================================
   JELLYFISH
   ======================================================================== */

/**
 * Declared in `oceanDrifterMaterials.ts` because both implementations of the
 * shader have to produce the same three, and re-exported here because that is
 * where every caller already looks for it.
 *
 * **IN-PLACE MUTATION OF A COLOUR REACHES BOTH PATHS**, which is not obvious for
 * the node one and was checked rather than assumed: `oceanRig` does
 * `uniforms.uJellyColor.value.set(...).lerp(...)` without ever replacing the
 * `Color`, and `UniformsGroup.updateColor` (`:419`) compares r, g and b against
 * its cached copy every frame rather than watching for a new object. A node
 * uniform that only noticed reassignment would have frozen this tint at its
 * construction colour, on the node path only, with nothing thrown.
 */
export type JellyfishUniforms = JellyfishFrameUniforms;

export type Jellyfish = {
  mesh: InstancedMesh;
  uniforms: JellyfishUniforms;
  dispose: () => void;
};

/**
 * A drifting bell layer.
 *
 * The bell contracts and its margin flares — that is propulsion, and it is what
 * separates a jellyfish from a wobbling sphere. Rendered additively and rim-lit
 * only, because a medusa is 95% water: what you see of one is its edge and the
 * light caught under its bell, never a lit surface.
 */
export function createJellyfish(options: {
  count: number;
  random: Random;
  radius: number;
  columnHeight: number;
  nodeModules: NodeMaterialModules | null;
}): Jellyfish {
  const { count, random, radius, columnHeight, nodeModules } = options;
  // An open hemisphere, not a sphere: a bell has an underside, and cutting the
  // geometry at 0.62π is what lets the shader see it.
  const bell = new SphereGeometry(0.5, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);

  const anchors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    // sqrt keeps the areal density even; without it every drifter crowds the axis.
    const distance = radius * (0.28 + 0.72 * Math.sqrt(random()));
    anchors[i * 3] = Math.cos(angle) * distance;
    anchors[i * 3 + 1] = 0;
    anchors[i * 3 + 2] = Math.sin(angle) * distance;
    seeds[i] = random() * 10;
  }
  bell.setAttribute(JELLYFISH_ANCHOR_ATTRIBUTE, new InstancedBufferAttribute(anchors, 3));
  bell.setAttribute(JELLYFISH_SEED_ATTRIBUTE, new InstancedBufferAttribute(seeds, 1));

  const { material, uniforms } = jellyfishMaterial(columnHeight, nodeModules);


  const mesh = new InstancedMesh(bell, material, count);
  const identity = new Matrix4();
  for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
  // The motion is entirely in the vertex shader, so the instance matrices never
  // move and the bounding sphere three.js computes from them is meaningless.
  mesh.frustumCulled = false;
  mesh.renderOrder = 2400;

  return {
    mesh,
    uniforms,
    dispose: () => {
      bell.dispose();
      material.dispose();
    },
  };
}

/* ========================================================================
   BUBBLE STREAMS
   ======================================================================== */

/** Declared in `oceanDrifterMaterials.ts` — see `JellyfishUniforms` above. */
export type BubbleUniforms = BubbleFrameUniforms;

export type Bubbles = {
  mesh: InstancedMesh;
  uniforms: BubbleUniforms;
  dispose: () => void;
};

/**
 * Rising bubbles, from a handful of vents.
 *
 * The vents are the whole design. Bubbles come from somewhere — a seep, a vent,
 * a diver — so **a stream reads as bubbles and a uniform scatter reads as
 * dust**. Nine anchor points, each with its own column, is the difference.
 *
 * Shaded on the rim only: a bubble has no body, and all you ever see of one is
 * the ring where its surface turns away from you.
 */
export function createBubbles(options: {
  count: number;
  random: Random;
  radiusOuter: number;
  ventCount?: number;
  nodeModules: NodeMaterialModules | null;
}): Bubbles {
  const { count, random, radiusOuter, ventCount = 9, nodeModules } = options;
  const geometry = new IcosahedronGeometry(1, 1);

  const vents: [number, number][] = [];
  for (let i = 0; i < ventCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radiusOuter;
    vents.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
  }

  const anchors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const vent = vents[Math.floor(random() * vents.length) % vents.length];
    anchors[i * 3] = vent[0] + (random() - 0.5) * 0.7;
    // Held in 0..1 and multiplied by the column height in the shader, so the
    // stream can be re-scaled per world without rebuilding the buffer.
    anchors[i * 3 + 1] = random();
    anchors[i * 3 + 2] = vent[1] + (random() - 0.5) * 0.7;
    seeds[i] = random() * 100;
  }
  geometry.setAttribute(BUBBLE_ANCHOR_ATTRIBUTE, new InstancedBufferAttribute(anchors, 3));
  geometry.setAttribute(BUBBLE_SEED_ATTRIBUTE, new InstancedBufferAttribute(seeds, 1));

  const { material, uniforms } = bubbleMaterial(nodeModules);


  const mesh = new InstancedMesh(geometry, material, count);
  const identity = new Matrix4();
  for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, identity);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2500;

  return {
    mesh,
    uniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ========================================================================
   MARINE SNOW
   ======================================================================== */

export type MoteUniforms = {
  uMoteTime: { value: number };
  uFogColor: { value: Color };
  uFogDensity: { value: number };
  uMoteOpacity: { value: number };
};

export type MoteLayer = {
  /**
   * A `Points` on the classic path and an instanced `Sprite` on the node one —
   * see `createMoteLayer`. Declared as the base class because every caller only
   * ever sets `visible`, moves it, or adds it to a group.
   */
  object: Object3D;
  uniforms: MoteUniforms;
  /** Bioluminescent layers flicker and blend additively; snow does neither. */
  living: boolean;
  dispose: () => void;
};

type MoteLayerSpec = {
  key: string;
  count: number;
  radius: number;
  height: number;
  size: number;
  color: string;
  opacity: number;
  fall: number;
  living?: boolean;
};

/**
 * The four layers, and why it is four rather than one.
 *
 * A single mote layer at one radius, one size and one fall rate is a uniform
 * haze — it reads as a dirty lens rather than as a medium with depth. Parallax
 * needs particles at genuinely different distances, and the layer that does most
 * of the work of putting the camera INSIDE the water is the near one: 130 large
 * soft motes at 14 m, the ones that drift past close enough to be individuals.
 *
 * The fourth is not snow at all. It is bioluminescence: fewer, brighter,
 * flickering, additive, and cyan — and below the photic zone it is the only
 * light being made anywhere in frame.
 */
const MOTE_LAYERS: readonly MoteLayerSpec[] = [
  { key: "snow-far", count: 2900, radius: 120, height: 70, size: 0.9, color: "#D8ECEF", opacity: 0.3, fall: 0.3 },
  { key: "snow-mid", count: 1200, radius: 46, height: 48, size: 2.4, color: "#E6F4F6", opacity: 0.26, fall: 0.24 },
  { key: "snow-near", count: 130, radius: 14, height: 26, size: 4.6, color: "#EAF7F9", opacity: 0.07, fall: 0.16 },
  { key: "biolum", count: 900, radius: 80, height: 60, size: 2.6, color: "#5CF2E0", opacity: 0.95, fall: 0.05, living: true },
];

function createMoteLayer(
  spec: MoteLayerSpec,
  random: Random,
  quality: "high" | "low",
  nodeModules: NodeMaterialModules | null,
): MoteLayer {
  // The low tier thins every layer rather than dropping one: losing the near
  // layer costs the medium cue that matters most, and losing the far one flattens
  // the depth. Keeping all four at a third of the count keeps the structure.
  const count = quality === "high" ? spec.count : Math.max(24, Math.round(spec.count / 3));

  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * spec.radius;
    positions[i * 3] = Math.cos(angle) * distance;
    positions[i * 3 + 1] = (random() - 0.5) * spec.height * 2;
    positions[i * 3 + 2] = Math.sin(angle) * distance;
    seeds[i] = random();
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(MOTE_SEED_ATTRIBUTE, new Float32BufferAttribute(seeds, 1));

  const { geometry: spriteGeometry, material, instanceCount, uniforms } = moteLayerBuild(
    {
      size: spec.size,
      color: spec.color,
      opacity: spec.opacity,
      fall: spec.fall,
      span: spec.height * 2,
      living: spec.living === true,
    },
    seeds,
    positions,
    nodeModules,
  );

  // THE NODE PATH DRAWS A SPRITE AND THE CLASSIC PATH DRAWS POINTS, which is why
  // this layer's field is an `Object3D` rather than a `Points`. WebGPU has no
  // point size at all, so a sized mote has to be an instanced quad there — see
  // `oceanMoteMaterial.ts`. Everything the rig does with it (`visible`,
  // `position`, `group.add`) is `Object3D`, so nothing downstream cares which.
  let object: Object3D;
  if (spriteGeometry) {
    // Its own quad, not the module-level one three shares between every sprite
    // it constructs (`Sprite.js:69-93`); attaching to that would attach to every
    // other sprite in the process, and this family mounts four of these.
    const sprite = new Sprite(material as unknown as SpriteMaterial);
    sprite.geometry = spriteGeometry;
    sprite.count = instanceCount;
    object = sprite;
  } else {
    object = new Points(geometry, material);
  }
  object.frustumCulled = false;

  return {
    object,
    uniforms,
    living: spec.living === true,
    dispose: () => {
      geometry.dispose();
      spriteGeometry?.dispose();
      material.dispose();
    },
  };
}

/** All four layers, built from one seeded stream so a world is reproducible. */
export function createMoteLayers(options: {
  random: Random;
  quality: "high" | "low";
  nodeModules: NodeMaterialModules | null;
}): MoteLayer[] {
  return MOTE_LAYERS.map((spec) => createMoteLayer(spec, options.random, options.quality, options.nodeModules));
}
