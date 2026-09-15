// `BufferGeometry`/`BufferAttribute` from `three` and the MATERIAL from the node
// copy, for the reason `sizedStarPointsMaterial.ts` states at length: geometry
// is data the renderer reads through flag checks, and every geometry in this app
// already reaches the node renderer as `three`'s.
import { BufferAttribute, BufferGeometry, type Blending, type Texture } from "three";
import type { Node } from "three/webgpu";
import {
  perInstanceAttribute,
  type NodeMaterialModules
} from "@/features/scene-renderers/shared/nodeMaterials";
import { NEBULA_CLOUD_ATLAS_VARIANT_COUNT } from "@/features/scene-renderers/shared/nebulaCloudTexture";

/**
 * THE NEBULA CLOUD SPRITE, IN BOTH SHADER LANGUAGES, FROM ONE SET OF NUMBERS.
 *
 * §26 Phase 8, §8.1 entry 9. Same construction as the star sprite beside it —
 * `Sprite` with `count` on the node path, `Points` with a raw `ShaderMaterial`
 * on the classic one, one set of constants for both — so only what differs is
 * documented here.
 *
 * **THE ROTATION IS DELIBERATELY NOT `PointsNodeMaterial.rotationNode`, AND THE
 * DIFFERENCE IS VISIBLE.** That node rotates the QUAD, in screen space, before
 * the fragment stage. This shader rotates the SAMPLE — the quad stays
 * axis-aligned and the atlas tile is read through a rotation, with the rotated
 * corners clamped back into the tile. The two give different footprints: a
 * rotated quad sweeps a larger screen area than an axis-aligned one of the same
 * size, so a layer of thousands of low-alpha sprites would accumulate a
 * different amount of overdraw — and overdraw statistics are precisely what
 * makes this layer read as continuous nebulosity rather than as separate puffs.
 * So the rotation stays in the fragment, where it already was.
 *
 * The clamp is load-bearing for the same reason it was in GLSL: a rotated
 * corner lands outside [0,1] and must not wrap into the NEIGHBOURING atlas tile.
 * The tile's own edge is transparent by construction, so clamping to it costs
 * nothing.
 *
 * Only the texture's ALPHA is read, which is why three's colour-space handling
 * on `texture()` does not enter into it: the alpha channel carries no colour
 * space.
 */

/** The quad's UV is [0,1]; the rotation has to happen about its centre. */
const TILE_CENTRE = 0.5;
const TILE_MINIMUM = 0;
const TILE_MAXIMUM = 1;

/**
 * Below this the sprite contributes less than a 255th of an 8-bit level at the
 * layer's opacities, so discarding is free and saves the blend on the many
 * mostly-empty corners of a cloud tile.
 */
const MINIMUM_VISIBLE_ALPHA = 0.004;

/** See shared/sizedStarPointsMaterial.ts for why a quad needs this and a point does not. */
const MINIMUM_VIEW_DEPTH_IN_FRONT_OF_CAMERA = -0.001;
const SPRITE_COLLAPSED_SIZE = 0;
const SPRITE_FULL_SIZE = 1;

/** three's `Sprite` quad spans [-0.5, 0.5] and its `uv` spans [0, 1]. */
const SPRITE_QUAD_POSITIONS = new Float32Array([
  -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0
]);
const SPRITE_QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const SPRITE_QUAD_INDICES = [0, 1, 2, 0, 2, 3];
const POSITION_COMPONENTS = 3;
const UV_COMPONENTS = 2;
const COLOR_COMPONENTS = 3;
const SCALAR_COMPONENTS = 1;

export const CLOUD_POINTS_VERTEX_SHADER = /* glsl */ `
  attribute float cloudSize;
  attribute vec3 cloudColor;
  attribute float cloudRotation;
  attribute float cloudAlpha;
  attribute float cloudVariant;
  uniform float uPointScale;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;
  varying float vCloudVariant;

  void main() {
    vCloudColor = cloudColor;
    vCloudRotation = cloudRotation;
    vCloudAlpha = cloudAlpha;
    vCloudVariant = cloudVariant;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = cloudSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Built from the constants above so that tuning one moves both implementations.
 * `nebulaCloudPointsMaterial.test.ts` asserts this text carries no numeric
 * literal the module does not declare.
 */
export function cloudPointsFragmentShaderGlsl(): string {
  return /* glsl */ `
  uniform sampler2D uCloudMap;
  uniform float uAtlasVariantCount;
  uniform float uGlobalOpacity;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;
  varying float vCloudVariant;

  void main() {
    vec2 centeredCoord = gl_PointCoord - vec2(${TILE_CENTRE});
    float rotationCosine = cos(vCloudRotation);
    float rotationSine = sin(vCloudRotation);
    vec2 rotatedCoord = vec2(
      centeredCoord.x * rotationCosine - centeredCoord.y * rotationSine,
      centeredCoord.x * rotationSine + centeredCoord.y * rotationCosine
    ) + vec2(${TILE_CENTRE});
    vec2 tileCoord = clamp(rotatedCoord, ${TILE_MINIMUM}.0, ${TILE_MAXIMUM}.0);
    float atlasU = (tileCoord.x + vCloudVariant) / uAtlasVariantCount;
    float sampledAlpha = texture2D(uCloudMap, vec2(atlasU, tileCoord.y)).a;
    float alpha = sampledAlpha * vCloudAlpha * uGlobalOpacity;
    if (alpha < ${MINIMUM_VISIBLE_ALPHA}) {
      discard;
    }
    gl_FragColor = vec4(vCloudColor, alpha);
  }
`;
}

export type CloudLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  rotations: Float32Array;
  alphas: Float32Array;
  variants: Float32Array;
};

export type CloudPointsNodeLayer = {
  geometry: BufferGeometry;
  material: InstanceType<NodeMaterialModules["webgpu"]["PointsNodeMaterial"]>;
  instanceCount: number;
  uniforms: { globalOpacity: { value: number } };
};

function spriteQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setIndex(SPRITE_QUAD_INDICES);
  geometry.setAttribute("position", new BufferAttribute(SPRITE_QUAD_POSITIONS, POSITION_COMPONENTS));
  geometry.setAttribute("uv", new BufferAttribute(SPRITE_QUAD_UVS, UV_COMPONENTS));
  return geometry;
}

/**
 * `atlasTexture` is a parameter rather than a module-level call because
 * `getNebulaCloudAtlasTexture()` returns null without a `document` — it paints
 * the atlas on a canvas — and a node graph cannot sample null. The node layer is
 * only ever built under a live renderer, so the caller has a texture; taking it
 * as an argument is what makes that a type, and it is also what lets the test
 * supply its own.
 */
export function buildCloudPointsNodeLayer(
  modules: NodeMaterialModules,
  clouds: CloudLayerAttributes,
  blending: Blending,
  atlasTexture: Texture
): CloudPointsNodeLayer {
  const { PointsNodeMaterial } = modules.webgpu;
  const {
    Discard,
    Fn,
    clamp,
    cos,
    float,
    instancedBufferAttribute,
    positionView,
    sin,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4
  } = modules.tsl;

  // `perInstanceAttribute` rather than `new BufferAttribute` — see its doc
  // comment for the three lines in three that decide whether these step per
  // instance or per vertex, and what a per-vertex step looks like on screen.
  const instancedScalar = (values: Float32Array) =>
    instancedBufferAttribute(perInstanceAttribute(values, SCALAR_COMPONENTS), "float");

  const cloudCentre = instancedBufferAttribute(perInstanceAttribute(clouds.positions, POSITION_COMPONENTS), "vec3");
  // Cast for the same reason the star material casts: TSL declares these
  // builders as returning a bare node, so the vector width has to be restated.
  const cloudColor = varying(
    instancedBufferAttribute(perInstanceAttribute(clouds.colors, COLOR_COMPONENTS), "vec3")
  ) as unknown as Node<"vec3">;
  const cloudSize = instancedScalar(clouds.sizes) as unknown as Node<"float">;
  const cloudRotation = varying(instancedScalar(clouds.rotations)) as unknown as Node<"float">;
  const cloudAlpha = varying(instancedScalar(clouds.alphas)) as unknown as Node<"float">;
  const cloudVariant = varying(instancedScalar(clouds.variants)) as unknown as Node<"float">;

  const globalOpacity = uniform(0);

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending
  });

  material.positionNode = cloudCentre;
  // The near-plane mask a quad does not inherit from a point primitive. These
  // layers surround the viewer, so at any moment roughly half of them are behind
  // the camera — where a `Points` is clipped and a sprite's clip-space offset
  // divided by a vanishing `w` becomes a screen-sized quad. See
  // `shared/sizedStarPointsMaterial.ts`, which carries the measurement.
  const inFrontOfCamera = positionView.z
    .lessThan(MINIMUM_VIEW_DEPTH_IN_FRONT_OF_CAMERA)
    .select(float(SPRITE_FULL_SIZE), float(SPRITE_COLLAPSED_SIZE));
  const maskedSize = cloudSize.mul(inFrontOfCamera);
  material.sizeNode = vec2(maskedSize, maskedSize);

  material.colorNode = Fn(() => {
    const centredCoordinate = uv().sub(TILE_CENTRE);
    const rotationCosine = cos(cloudRotation);
    const rotationSine = sin(cloudRotation);
    const rotatedCoordinate = vec2(
      centredCoordinate.x.mul(rotationCosine).sub(centredCoordinate.y.mul(rotationSine)),
      centredCoordinate.x.mul(rotationSine).add(centredCoordinate.y.mul(rotationCosine))
    ).add(TILE_CENTRE);
    const tileCoordinate = clamp(rotatedCoordinate, TILE_MINIMUM, TILE_MAXIMUM);
    const atlasU = tileCoordinate.x.add(cloudVariant).div(NEBULA_CLOUD_ATLAS_VARIANT_COUNT);
    const sampledAlpha = texture(atlasTexture, vec2(atlasU, tileCoordinate.y)).a;
    const alpha = sampledAlpha.mul(cloudAlpha).mul(globalOpacity);
    Discard(alpha.lessThan(MINIMUM_VISIBLE_ALPHA));
    return vec4(vec3(cloudColor), float(alpha));
  })();

  return {
    geometry: spriteQuadGeometry(),
    material,
    instanceCount: clouds.sizes.length,
    uniforms: { globalOpacity }
  };
}
