import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  ShaderMaterial,
  type Blending,
  type Material
} from "three";
import type { Node } from "three/webgpu";
import { perInstanceAttribute, type NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * MARINE SNOW, IN BOTH SHADER LANGUAGES, FROM ONE SET OF NUMBERS.
 *
 * §26 Phases 6-8, the ocean. The third drifter, and the one that could not go in
 * `oceanDrifterMaterials.ts` with the other two: the jellyfish and the bubbles
 * are `InstancedMesh`es and their port is a material swap, while this is a
 * `Points` layer and **WebGPU has no point size at all**. A sized point has to
 * become an instanced QUAD there, so this port changes the scene graph and not
 * just the shader — the same architectural change `sizedStarPointsMaterial.ts`
 * made for the universe's stars, and the reason that file exists to copy.
 *
 * WHAT THE LAYER IS. Debris, not light: mineral and organic flakes that REFLECT
 * what is already in the water. That is why the three snow layers blend normally
 * and only the bioluminescent fourth is additive — 4200 flakes added to every
 * frame is most of the abyss's brightness, and it was.
 *
 * Like the other drifters, nothing here is tone mapped or colour-space encoded.
 * `oceanDrifterMaterials.ts` has the long version of why; the short version is
 * that these are near-additive at 0.07 to 0.30 opacity and encoding them lifts
 * the whole water column.
 */

/** Radians in a full turn, as the GLSL spells it. */
const FULL_TURN_RADIANS = 6.2831853;

/**
 * The fall. Marine snow descends slowly and never in step — the seed offsets
 * both the rate and the phase, so no two flakes share a cycle. A layer whose
 * motes fell together would read as a curtain.
 */
const FALL_RATE_MINIMUM = 0.6;
const FALL_RATE_SEED_RANGE = 0.8;

/** The column is centred on the layer, so a flake leaving the bottom re-enters at the top. */
const SPAN_CENTRE_FRACTION = 0.5;

/** A slow lateral sway, so the fall is not a straight line. */
const SWAY_RADIANS_PER_SECOND = 0.2;
const SWAY_AMPLITUDE = 0.4;

/**
 * The medium, applied per mote rather than by three's fog.
 *
 * A mote far enough away is the water's own colour, which is what puts the
 * camera INSIDE the medium rather than looking at a tank. The squared falloff is
 * what keeps near motes crisp while the far ones dissolve.
 */
const FOG_DENSITY_PER_UNIT = 0.02;
const FOG_FALLOFF_POWER = 2;
const FOG_ALPHA_WEIGHT = 0.85;

/** Living light pulses; a mineral flake does not. Only the biolum layer sets the mix to 1. */
const FLICKER_BASE = 0.45;
const FLICKER_AMPLITUDE = 0.55;
const FLICKER_RADIANS_PER_SECOND = 1.4;
const FLICKER_SEED_RATE = 3;
const FLICKER_SEED_PHASE = 12;

/** Per-mote size jitter, so a layer is not one repeated dot. */
const SIZE_SEED_RANGE = 0.6;

/**
 * 300, not a smaller "safer" number: this is the demo's own constant, and
 * undersizing it is why the motes read as barely-there specks instead of the
 * "single highest-value cheap change" its own comment calls them.
 *
 * **IT IS NOT THE STAR LAYER'S CONVENTION AND MUST NOT BE PORTED AS IF IT
 * WERE.** `SizedStarPoints` scales by half the drawing buffer's height, which is
 * exactly what three's own `sizeAttenuation` computes — so the star port hands
 * three a raw size and lets it do the division. This layer scales by a FIXED
 * 300 instead, so the node path has to turn `sizeAttenuation` off and do the
 * division itself. Letting three attenuate this one would silently re-scale
 * every mote with the window.
 */
const POINT_SIZE_SCALE = 300;
const MINIMUM_VIEW_DISTANCE = 1;

/** The sprite is a disc inscribed in its quad; outside that radius it is discarded. */
const SPRITE_EDGE_RADIUS = 0.5;
const ALPHA_FALLOFF_POWER = 1.7;

/** The quad the node path draws, and the coordinates its fragment reads. */
const QUAD_COORDINATE_SCALE = 2;
const SPRITE_QUAD_POSITIONS = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const SPRITE_QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const SPRITE_QUAD_INDICES = [0, 1, 2, 0, 2, 3];
const POSITION_COMPONENTS = 3;
const UV_COMPONENTS = 2;
const SCALAR_COMPONENTS = 1;

export const MOTE_SEED_ATTRIBUTE = "aMoteSeed";

/**
 * Built from the constants above rather than written out, so that tuning one
 * moves both implementations. `oceanMoteMaterial.test.ts` asserts this text
 * carries no numeric literal the module does not declare.
 */
export function moteVertexShaderGlsl(): string {
  return /* glsl */ `
      attribute float ${MOTE_SEED_ATTRIBUTE};
      uniform float uMoteTime;
      uniform float uMoteSize;
      uniform float uMoteFall;
      uniform float uMoteSpan;
      uniform float uMoteFlicker;
      varying float vFogFactor;
      varying float vFlicker;
      void main(){
        vec3 p = position;
        // Marine snow falls. Slowly, and never in step: the seed offsets both the
        // rate and the phase, so no two motes share a cycle.
        p.y -= mod(uMoteTime * uMoteFall * (${FALL_RATE_MINIMUM} + ${MOTE_SEED_ATTRIBUTE} * ${FALL_RATE_SEED_RANGE}) + ${MOTE_SEED_ATTRIBUTE} * uMoteSpan, uMoteSpan)
             - uMoteSpan * ${SPAN_CENTRE_FRACTION};
        p.x += sin(uMoteTime * ${SWAY_RADIANS_PER_SECOND} + ${MOTE_SEED_ATTRIBUTE} * ${FULL_TURN_RADIANS}) * ${SWAY_AMPLITUDE};
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        float viewDistance = -viewPosition.z;
        vFogFactor = 1.0 - exp(-pow(max(0.0, viewDistance) * ${FOG_DENSITY_PER_UNIT}, ${FOG_FALLOFF_POWER}.0));
        // Living light pulses; a mineral flake does not.
        vFlicker = mix(1.0, ${FLICKER_BASE} + ${FLICKER_AMPLITUDE} * sin(uMoteTime * (${FLICKER_RADIANS_PER_SECOND} + ${MOTE_SEED_ATTRIBUTE} * ${FLICKER_SEED_RATE}.0) + ${MOTE_SEED_ATTRIBUTE} * ${FLICKER_SEED_PHASE}.0),
                       uMoteFlicker);
        gl_PointSize = uMoteSize * (1.0 + ${MOTE_SEED_ATTRIBUTE} * ${SIZE_SEED_RANGE}) * (${POINT_SIZE_SCALE}.0 / max(${MINIMUM_VIEW_DISTANCE}.0, viewDistance));
        gl_Position = projectionMatrix * viewPosition;
      }`;
}

export function moteFragmentShaderGlsl(): string {
  return /* glsl */ `
      uniform vec3 uFogColor;
      uniform vec3 uMoteColor;
      uniform float uMoteOpacity;
      varying float vFogFactor;
      varying float vFlicker;
      void main(){
        vec2 offset = gl_PointCoord - ${SPRITE_EDGE_RADIUS};
        float radius = length(offset);
        if (radius > ${SPRITE_EDGE_RADIUS}) discard;
        float alpha = pow(1.0 - radius * ${QUAD_COORDINATE_SCALE}.0, ${ALPHA_FALLOFF_POWER}) * uMoteOpacity * vFlicker;
        gl_FragColor = vec4(mix(uMoteColor, uFogColor, vFogFactor), alpha * (1.0 - vFogFactor * ${FOG_ALPHA_WEIGHT}));
        // Not encoded — see the module header.
      }`;
}

/** The per-layer values the four mote layers differ by. */
export type MoteLayerSettings = {
  size: number;
  color: string;
  opacity: number;
  fall: number;
  /** The full height of the column, which the fall is taken modulo. */
  span: number;
  living: boolean;
};

/** What `useFrame` and the rig keep current, identically on both paths. */
export type MoteFrameUniforms = {
  uMoteTime: { value: number };
  uFogColor: { value: Color };
  /**
   * **DEAD ON BOTH PATHS, DELIBERATELY.** `oceanRig:752` writes the water's fog
   * density here every frame and neither shader stage declares it — the mote fog
   * is the fixed `FOG_DENSITY_PER_UNIT` instead. It is kept so the rig's write
   * still lands somewhere and the two paths stay identical, and because deleting
   * it would hide the question rather than answer it. See the note beside
   * `fogFactor`: making the motes honour it is a look change and belongs in its
   * own commit.
   */
  uFogDensity: { value: number };
  uMoteOpacity: { value: number };
};

export type MoteLayerBuild = {
  /**
   * Null on the classic path, where the caller builds its own `BufferGeometry`
   * for a `Points`. The node path needs a quad and its own instanced
   * attributes, so it supplies them.
   */
  geometry: BufferGeometry | null;
  material: Material;
  /** 1 on the classic path, which draws one `Points` and not N instances. */
  instanceCount: number;
  uniforms: MoteFrameUniforms;
};

const DEFAULT_FOG_COLOR = "#0A2438";
const DEFAULT_FOG_DENSITY = 0.02;

function moteBlending(living: boolean): Blending {
  return living ? AdditiveBlending : NormalBlending;
}

function classicMoteUniforms(settings: MoteLayerSettings): MoteFrameUniforms {
  return {
    uMoteTime: { value: 0 },
    uFogColor: { value: new Color(DEFAULT_FOG_COLOR) },
    uFogDensity: { value: DEFAULT_FOG_DENSITY },
    uMoteOpacity: { value: settings.opacity }
  };
}

function classicMoteLayer(settings: MoteLayerSettings): MoteLayerBuild {
  const uniforms = classicMoteUniforms(settings);
  const material = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uMoteColor: { value: new Color(settings.color) },
      uMoteSize: { value: settings.size },
      uMoteFall: { value: settings.fall },
      uMoteSpan: { value: settings.span },
      uMoteFlicker: { value: settings.living ? 1 : 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: moteBlending(settings.living),
    fog: false,
    vertexShader: moteVertexShaderGlsl(),
    fragmentShader: moteFragmentShaderGlsl()
  });
  return { geometry: null, material, instanceCount: 1, uniforms };
}

/**
 * The node path: one instanced `Sprite` quad per mote.
 *
 * **THE SIZE IS DIVIDED BY `screenDPR`, AND THAT IS NOT A ROUNDING DETAIL.**
 * `gl_PointSize` is in FRAMEBUFFER pixels, so the GLSL's fixed 300 already
 * includes the device pixel ratio. `PointsNodeMaterial.setupVertexSprite`
 * multiplies `sizeNode` by `screenDPR` (`PointsNodeMaterial.js:109`), treating
 * it as LOGICAL pixels, so handing it the same expression would scale every mote
 * by the ratio again. The harness runs at `--force-device-scale-factor=1`, where
 * this is invisible — it would have been wrong only on the retina displays
 * nothing in this repo photographs.
 *
 * `sizeAttenuation` is turned OFF for the reason `POINT_SIZE_SCALE` documents:
 * three's attenuation is the star layer's convention, not this one's.
 */
function nodeMoteLayer(
  modules: NodeMaterialModules,
  settings: MoteLayerSettings,
  seeds: Float32Array,
  positions: Float32Array
): MoteLayerBuild {
  const { PointsNodeMaterial } = modules.webgpu;
  const {
    Discard,
    Fn,
    exp,
    float,
    instancedBufferAttribute,
    max,
    mix,
    pow,
    positionView,
    screenDPR,
    sin,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4
  } = modules.tsl;

  const geometry = new BufferGeometry();
  geometry.setIndex(SPRITE_QUAD_INDICES);
  geometry.setAttribute("position", new BufferAttribute(SPRITE_QUAD_POSITIONS, POSITION_COMPONENTS));
  geometry.setAttribute("uv", new BufferAttribute(SPRITE_QUAD_UVS, UV_COMPONENTS));

  // `perInstanceAttribute`, not `new BufferAttribute` — see its doc comment for
  // the three lines in three that decide whether these step per instance or per
  // vertex, and what a per-vertex step does to the frame.
  const moteCentre = instancedBufferAttribute(
    perInstanceAttribute(positions, POSITION_COMPONENTS),
    "vec3"
  ) as unknown as Node<"vec3">;
  const seed = instancedBufferAttribute(
    perInstanceAttribute(seeds, SCALAR_COMPONENTS),
    "float"
  ) as unknown as Node<"float">;

  const uMoteTime = uniform(0);
  const uFogColor = uniform(new Color(DEFAULT_FOG_COLOR));
  const uFogDensity = uniform(DEFAULT_FOG_DENSITY);
  const uMoteOpacity = uniform(settings.opacity);
  const uMoteColor = uniform(new Color(settings.color));
  const moteSize = float(settings.size);
  const moteFall = float(settings.fall);
  const moteSpan = float(settings.span);

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: moteBlending(settings.living)
  });
  material.fog = false;
  material.sizeAttenuation = false;

  const fallOffset = uMoteTime
    .mul(moteFall)
    .mul(float(FALL_RATE_MINIMUM).add(seed.mul(FALL_RATE_SEED_RANGE)))
    .add(seed.mul(moteSpan))
    .mod(moteSpan)
    .sub(moteSpan.mul(SPAN_CENTRE_FRACTION));
  const sway = sin(uMoteTime.mul(SWAY_RADIANS_PER_SECOND).add(seed.mul(FULL_TURN_RADIANS))).mul(SWAY_AMPLITUDE);
  material.positionNode = vec3(moteCentre.x.add(sway), moteCentre.y.sub(fallOffset), moteCentre.z);

  const viewDistance = positionView.z.negate();
  const perMoteSize = moteSize
    .mul(float(1).add(seed.mul(SIZE_SEED_RANGE)))
    .mul(float(POINT_SIZE_SCALE).div(max(float(MINIMUM_VIEW_DISTANCE), viewDistance)))
    .div(screenDPR);
  material.sizeNode = vec2(perMoteSize, perMoteSize);

  // `FOG_DENSITY_PER_UNIT`, NOT `uFogDensity`, AND THAT IS FAITHFUL RATHER THAN
  // LAZY. The GLSL hardcodes 0.02 here: `uFogDensity` is declared in NEITHER
  // shader stage, so the value `oceanRig:752` writes into it every frame is read
  // by nothing. Using the uniform on this path alone would make the node frame
  // track the water's fog density while the classic frame does not — a
  // divergence measured as +0.23 of 255 before it was caught.
  //
  // **THE DEAD UNIFORM IS PROBABLY A BUG, AND FIXING IT HERE WOULD BE THE WRONG
  // PLACE.** The motes fog at a fixed rate regardless of how thick the water is,
  // which is unlikely to be what anyone intended for the abyss. Making them
  // honour it is a LOOK CHANGE, on the classic path every visitor sees, and it
  // belongs in its own change with its own before-and-after — not smuggled in
  // under a port whose whole claim is that the two paths match.
  const fogFactor = varying(
    float(1).sub(
      exp(pow(max(float(0), viewDistance).mul(FOG_DENSITY_PER_UNIT), float(FOG_FALLOFF_POWER)).negate())
    )
  ) as unknown as Node<"float">;
  const flicker = varying(
    mix(
      float(1),
      float(FLICKER_BASE).add(
        sin(
          uMoteTime
            .mul(float(FLICKER_RADIANS_PER_SECOND).add(seed.mul(FLICKER_SEED_RATE)))
            .add(seed.mul(FLICKER_SEED_PHASE))
        ).mul(FLICKER_AMPLITUDE)
      ),
      float(settings.living ? 1 : 0)
    )
  ) as unknown as Node<"float">;

  material.colorNode = Fn(() => {
    // `uv()` rather than `gl_PointCoord`: the quad carries its own coordinates,
    // which is what `gl_PointCoord` was standing in for. `pointUV` still emits
    // `gl_PointCoord` on every builder and is unusable here.
    const offset = uv().sub(SPRITE_EDGE_RADIUS);
    const radius = offset.length();
    Discard(radius.greaterThan(SPRITE_EDGE_RADIUS));

    const alpha = pow(float(1).sub(radius.mul(QUAD_COORDINATE_SCALE)), float(ALPHA_FALLOFF_POWER))
      .mul(uMoteOpacity)
      .mul(flicker);
    return vec4(
      mix(uMoteColor, uFogColor, fogFactor),
      alpha.mul(float(1).sub(fogFactor.mul(FOG_ALPHA_WEIGHT)))
    );
  })();

  return {
    geometry,
    material: material as unknown as Material,
    instanceCount: seeds.length,
    uniforms: { uMoteTime, uFogColor, uFogDensity, uMoteOpacity } as unknown as MoteFrameUniforms
  };
}

/**
 * The mote layer's geometry and material for whichever renderer is drawing.
 *
 * `nodeModules` is null on the classic path, which is every visitor until
 * Phase 9 — see `shared/nodeMaterials.ts`.
 */
export function moteLayerBuild(
  settings: MoteLayerSettings,
  seeds: Float32Array,
  positions: Float32Array,
  nodeModules: NodeMaterialModules | null
): MoteLayerBuild {
  return nodeModules ? nodeMoteLayer(nodeModules, settings, seeds, positions) : classicMoteLayer(settings);
}
