import { AdditiveBlending, Color, ShaderMaterial, type Material } from "three";
import type { Node } from "three/webgpu";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE DRIFTERS' SHADERS, IN BOTH SHADER LANGUAGES, FROM ONE SET OF NUMBERS.
 *
 * §26 Phases 6-8, the ocean. `forestFoliageMaterial.ts` states the general shape
 * and why both implementations ship at once; this file is the ocean's first
 * entry and covers the two `InstancedMesh` drifters — the jellyfish bell and the
 * bubble stream. Marine snow is a `Points` layer and needs the sprite treatment
 * `sizedStarPointsMaterial.ts` established, so it is a separate unit.
 *
 * **WHY THESE TWO ARE ONE FILE.** They are the same material twice: an additive,
 * depth-write-free, rim-lit shell whose motion is entirely in the vertex stage
 * and whose fragment stage is a rim term and a tint. Splitting them would
 * duplicate the rule below in two places, which is the one thing that must not
 * drift.
 *
 * **NOTHING HERE IS TONE MAPPED OR COLOUR-SPACE ENCODED, AND THAT IS LOAD
 * BEARING.** Both were once added to every fragment shader in this family by a
 * sweep, enforced by a test. The rule was right for opaque surfaces and wrong
 * for these, because these layers are ADDITIVE: they do not replace what is
 * behind them, they are summed into it. sRGB encoding is steep near black — a
 * linear 0.15 encodes to 0.40 — so encoding a small additive contribution
 * inflates it roughly two and a half times before it is added. Four layers doing
 * that at once is a haze over every underwater frame, and on the god rays it
 * clipped the whole visible band to white once the camera looked along the
 * shafts.
 *
 * The node path gets this for free rather than by suppression: a
 * `NodeMaterial`'s `colorNode` writes into a linear render target and the post
 * chain encodes once, at the end, for the whole frame — which is exactly what
 * the raw `ShaderMaterial` achieves by writing `gl_FragColor` unconverted.
 * Neither path may grow its own encode.
 */

/** Radians in a full turn, as the GLSL spells it. */
const FULL_TURN_RADIANS = 6.2831853;

/* ========================================================================
   JELLYFISH
   ======================================================================== */

/**
 * The bell contracts and its margin flares — that is propulsion, and it is what
 * separates a jellyfish from a wobbling sphere. The two numbers move in
 * opposite directions on purpose: a bell that only shrank would read as a
 * breathing ball.
 */
const BELL_PULSE_RADIANS_PER_SECOND = 1.15;
const BELL_MARGIN_FLARE = 0.22;
const BELL_CONTRACTION = 0.3;

/** Per-instance size, from the seed's fractional part. */
const BELL_MINIMUM_SCALE = 0.34;
const BELL_SCALE_RANGE = 0.62;

/** How fast a medusa climbs its column, in columns per second. */
const BELL_RISE_COLUMNS_PER_SECOND = 0.08;

/**
 * The lateral drift. Two different rates and two different seed multipliers, so
 * the x and z wanders never synchronise into a circle.
 */
const BELL_DRIFT_X_RADIANS_PER_SECOND = 0.11;
const BELL_DRIFT_X_SEED_MULTIPLIER = 3;
const BELL_DRIFT_Z_RADIANS_PER_SECOND = 0.09;
const BELL_DRIFT_Z_SEED_MULTIPLIER = 2;
const BELL_DRIFT_RADIUS = 2.4;

/**
 * Rim and underside.
 *
 * A medusa is 95% water: what you see of one is its edge and the light caught
 * under its bell, never a lit surface. The rim power is what keeps the term at
 * the silhouette instead of washing across the body, and the underside band is
 * read off the bell's own local height — which only works because the geometry
 * is cut open at 0.62π rather than closed.
 */
const BELL_RIM_FALLOFF_POWER = 1.6;
const BELL_UNDERSIDE_BAND_TOP = 0.4;
const BELL_UNDERSIDE_BAND_BOTTOM = -0.5;
const BELL_RIM_ALPHA_WEIGHT = 0.85;
const BELL_UNDERSIDE_ALPHA_WEIGHT = 0.2;
const BELL_RIM_BRIGHTNESS = 1.4;
const BELL_AMBIENT_BRIGHTNESS = 0.15;

/** The column position is held in 0..1 and centred on the layer. */
const COLUMN_CENTRE_FRACTION = 0.5;

export const JELLYFISH_ANCHOR_ATTRIBUTE = "aJellyAnchor";
export const JELLYFISH_SEED_ATTRIBUTE = "aJellySeed";

/**
 * Built from the constants above rather than written out, so that tuning one
 * moves both implementations. `oceanDrifterMaterials.test.ts` asserts this text
 * carries no numeric literal the module does not declare.
 */
export function jellyfishVertexShaderGlsl(): string {
  return /* glsl */ `
      attribute vec3 ${JELLYFISH_ANCHOR_ATTRIBUTE};
      attribute float ${JELLYFISH_SEED_ATTRIBUTE};
      uniform float uJellyTime;
      uniform float uJellyColumn;
      varying float vRim;
      varying float vUnder;
      void main(){
        float pulse = sin(uJellyTime * ${BELL_PULSE_RADIANS_PER_SECOND} + ${JELLYFISH_SEED_ATTRIBUTE} * ${FULL_TURN_RADIANS}) * ${COLUMN_CENTRE_FRACTION} + ${COLUMN_CENTRE_FRACTION};
        vec3 p = position;
        // Contract and flare: the margin widens as the bell shortens.
        p.xz *= 1.0 + pulse * ${BELL_MARGIN_FLARE};
        p.y *= 1.0 - pulse * ${BELL_CONTRACTION};
        float bellScale = ${BELL_MINIMUM_SCALE} + fract(${JELLYFISH_SEED_ATTRIBUTE}) * ${BELL_SCALE_RANGE};
        float rise = mod(uJellyTime * ${BELL_RISE_COLUMNS_PER_SECOND} + ${JELLYFISH_SEED_ATTRIBUTE}, 1.0);
        vec3 world = ${JELLYFISH_ANCHOR_ATTRIBUTE}
          + vec3(sin(uJellyTime * ${BELL_DRIFT_X_RADIANS_PER_SECOND} + ${JELLYFISH_SEED_ATTRIBUTE} * ${BELL_DRIFT_X_SEED_MULTIPLIER}.0) * ${BELL_DRIFT_RADIUS},
                 rise * uJellyColumn - uJellyColumn * ${COLUMN_CENTRE_FRACTION},
                 cos(uJellyTime * ${BELL_DRIFT_Z_RADIANS_PER_SECOND} + ${JELLYFISH_SEED_ATTRIBUTE} * ${BELL_DRIFT_Z_SEED_MULTIPLIER}.0) * ${BELL_DRIFT_RADIUS})
          + p * bellScale;
        vec4 viewPosition = modelViewMatrix * vec4(world, 1.0);
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * normalize(position));
        vRim = pow(1.0 - abs(dot(viewNormal, normalize(-viewPosition.xyz))), ${BELL_RIM_FALLOFF_POWER});
        vUnder = smoothstep(${BELL_UNDERSIDE_BAND_TOP}, ${BELL_UNDERSIDE_BAND_BOTTOM}, position.y);
        gl_Position = projectionMatrix * viewPosition;
      }`;
}

export function jellyfishFragmentShaderGlsl(): string {
  return /* glsl */ `
      uniform vec3 uJellyColor;
      uniform float uJellyGlow;
      varying float vRim;
      varying float vUnder;
      void main(){
        float alpha = (vRim * ${BELL_RIM_ALPHA_WEIGHT} + vUnder * ${BELL_UNDERSIDE_ALPHA_WEIGHT}) * uJellyGlow;
        gl_FragColor = vec4(uJellyColor * (vRim * ${BELL_RIM_BRIGHTNESS} + ${BELL_AMBIENT_BRIGHTNESS}), alpha);
        // Not encoded and not tone mapped — see the header.
      }`;
}

/** What `useFrame` keeps current, identically on both paths. */
export type JellyfishFrameUniforms = {
  uJellyTime: { value: number };
  uJellyColor: { value: Color };
  uJellyGlow: { value: number };
};

export type DrifterMaterial<TUniforms> = {
  material: Material;
  uniforms: TUniforms;
};

const JELLYFISH_TINT = "#7FE9FF";
const JELLYFISH_GLOW = 0.4;

function jellyfishClassicUniforms(): JellyfishFrameUniforms {
  return {
    uJellyTime: { value: 0 },
    uJellyColor: { value: new Color(JELLYFISH_TINT) },
    uJellyGlow: { value: JELLYFISH_GLOW }
  };
}

function classicJellyfishMaterial(columnHeight: number): DrifterMaterial<JellyfishFrameUniforms> {
  const uniforms = jellyfishClassicUniforms();
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, uJellyColumn: { value: columnHeight } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: jellyfishVertexShaderGlsl(),
    fragmentShader: jellyfishFragmentShaderGlsl()
  });
  return { material, uniforms };
}

/**
 * The node path.
 *
 * **`positionNode` IS THE RIGHT HOOK AND `world` IS ALREADY LOCAL.** The GLSL
 * names its result `world` and then multiplies it by `modelViewMatrix`, so what
 * it builds is the mesh's LOCAL space despite the name — which is precisely what
 * `positionNode` replaces. The instance matrices are all identity (the motion is
 * in the shader), so three's own instancing applied on top of this is a no-op.
 *
 * **THE NORMAL IS THE POSITION, NOT THE NORMAL ATTRIBUTE**, on both paths. The
 * bell is a sphere section centred on its own origin, so the outward direction
 * IS the normalised local position — and the deformed `p` must not be used for
 * it, because the pulse would then swing the rim term as the bell breathes.
 *
 * **`positionGeometry`, NOT `positionLocal`, IS WHAT THE GLSL CALLS
 * `position` — and the difference is invisible until you look at the frame.**
 * `NodeMaterial.setupPosition` does `positionLocal.assign(this.positionNode)`
 * (`NodeMaterial.js:804`), so the moment a material sets `positionNode`,
 * `positionLocal` holds the DEFORMED result rather than the vertex attribute.
 * `positionGeometry` is `attribute('position','vec3')` (`Position.js:33`) and
 * stays the attribute.
 *
 * Getting this wrong compiles, throws nothing, and renders the bubbles as solid
 * white discs instead of rings: the rim term is `1 - |dot(normal, viewDir)|`
 * with the normal taken from the sphere's own outward direction, and feeding it
 * the bubble's world position instead makes it near-constant across the sprite,
 * so the silhouette falloff that IS the bubble disappears. It was found by
 * cropping the two frames side by side — the positions matched exactly and the
 * shading did not — and by nothing else: parity moved by 0.15 of 255, which is
 * inside the ocean's recorded headroom and would have shipped.
 */
function nodeJellyfishMaterial(
  modules: NodeMaterialModules,
  columnHeight: number
): DrifterMaterial<JellyfishFrameUniforms> {
  const { NodeMaterial } = modules.webgpu;
  const {
    abs,
    attribute,
    dot,
    float,
    fract,
    mod,
    modelViewMatrix,
    normalize,
    positionGeometry,
    positionViewDirection,
    pow,
    sin,
    cos,
    smoothstep,
    uniform,
    varying,
    vec3,
    vec4
  } = modules.tsl;

  const uJellyTime = uniform(0);
  // A `Color` gives this uniform TSL's `"color"` node type rather than `"vec3"`,
  // and that is the type to keep: `"color"` multiplies by a float and lands in
  // `vec4()` directly, while asking for `"vec3"` is rejected outright. The
  // uniform holds the `Color` INSTANCE either way, so `.value` reads and writes
  // exactly as the classic path's `IUniform` does.
  const uJellyColor = uniform(new Color(JELLYFISH_TINT));
  const uJellyGlow = uniform(JELLYFISH_GLOW);
  const uJellyColumn = uniform(columnHeight);

  // Cast for the reason `sizedStarPointsMaterial.ts` gives at its own
  // attributes: TSL declares `attribute()` as returning a bare `AttributeNode`
  // carrying no operator methods, so the width has to be restated even though
  // the runtime value already knows it. These are the geometry's
  // `InstancedBufferAttribute`s, which three steps per instance without help —
  // see `perInstanceAttribute` for the case where it does not.
  const anchor = attribute(JELLYFISH_ANCHOR_ATTRIBUTE, "vec3") as unknown as Node<"vec3">;
  const seed = attribute(JELLYFISH_SEED_ATTRIBUTE, "float") as unknown as Node<"float">;

  const pulse = sin(uJellyTime.mul(BELL_PULSE_RADIANS_PER_SECOND).add(seed.mul(FULL_TURN_RADIANS)))
    .mul(COLUMN_CENTRE_FRACTION)
    .add(COLUMN_CENTRE_FRACTION);

  const deformed = vec3(
    positionGeometry.x.mul(float(1).add(pulse.mul(BELL_MARGIN_FLARE))),
    positionGeometry.y.mul(float(1).sub(pulse.mul(BELL_CONTRACTION))),
    positionGeometry.z.mul(float(1).add(pulse.mul(BELL_MARGIN_FLARE)))
  );

  const bellScale = float(BELL_MINIMUM_SCALE).add(fract(seed).mul(BELL_SCALE_RANGE));
  const rise = mod(uJellyTime.mul(BELL_RISE_COLUMNS_PER_SECOND).add(seed), float(1));

  const drift = vec3(
    sin(uJellyTime.mul(BELL_DRIFT_X_RADIANS_PER_SECOND).add(seed.mul(BELL_DRIFT_X_SEED_MULTIPLIER))).mul(
      BELL_DRIFT_RADIUS
    ),
    rise.mul(uJellyColumn).sub(uJellyColumn.mul(COLUMN_CENTRE_FRACTION)),
    cos(uJellyTime.mul(BELL_DRIFT_Z_RADIANS_PER_SECOND).add(seed.mul(BELL_DRIFT_Z_SEED_MULTIPLIER))).mul(
      BELL_DRIFT_RADIUS
    )
  );

  const material = new NodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.fog = false;
  material.positionNode = anchor.add(drift).add(deformed.mul(bellScale));

  // `mat3(modelViewMatrix)` in the GLSL; TSL has no mat3 cast on a mat4 uniform
  // that reads as clearly, and the direction is renormalised immediately after,
  // so the translation column is harmless — it is multiplied by a w of 0.
  const viewNormal = normalize(modelViewMatrix.mul(vec4(normalize(positionGeometry), 0)).xyz);
  const rim = varying(
    pow(float(1).sub(abs(dot(viewNormal, positionViewDirection))), float(BELL_RIM_FALLOFF_POWER))
  ) as unknown as ReturnType<typeof float>;
  const underside = varying(
    smoothstep(float(BELL_UNDERSIDE_BAND_TOP), float(BELL_UNDERSIDE_BAND_BOTTOM), positionGeometry.y)
  ) as unknown as ReturnType<typeof float>;

  const alpha = rim.mul(BELL_RIM_ALPHA_WEIGHT).add(underside.mul(BELL_UNDERSIDE_ALPHA_WEIGHT)).mul(uJellyGlow);
  material.colorNode = vec4(
    uJellyColor.mul(rim.mul(BELL_RIM_BRIGHTNESS).add(BELL_AMBIENT_BRIGHTNESS)),
    alpha
  );

  return {
    material: material as unknown as Material,
    uniforms: {
      uJellyTime,
      uJellyColor,
      uJellyGlow
    } as unknown as JellyfishFrameUniforms
  };
}

/**
 * The jellyfish bell's material for whichever renderer is drawing.
 *
 * `nodeModules` is null on the classic path, which is every visitor until
 * Phase 9 — see `shared/nodeMaterials.ts`.
 */
export function jellyfishMaterial(
  columnHeight: number,
  nodeModules: NodeMaterialModules | null
): DrifterMaterial<JellyfishFrameUniforms> {
  return nodeModules ? nodeJellyfishMaterial(nodeModules, columnHeight) : classicJellyfishMaterial(columnHeight);
}

/* ========================================================================
   BUBBLE STREAMS
   ======================================================================== */

/**
 * How fast a bubble climbs, in scene units per second, and how much it grows
 * doing it.
 *
 * The expansion is not decoration: less pressure above means a bigger bubble,
 * and a stream whose bubbles stayed one size reads as falling snow going the
 * wrong way. It scales the wobble too, for the same reason — a larger bubble
 * wanders further.
 */
const BUBBLE_RISE_UNITS_PER_SECOND = 0.42;
const BUBBLE_EXPANSION_OVER_CLIMB = 1.5;

/** Per-instance radius, from the seed's fractional part. */
const BUBBLE_MINIMUM_RADIUS = 0.035;
const BUBBLE_RADIUS_RANGE = 0.075;

/**
 * The wobble. Two rates and two seed multipliers again, so x and z never
 * synchronise into a helix.
 */
const BUBBLE_WOBBLE_X_RADIANS_PER_UNIT = 1.7;
const BUBBLE_WOBBLE_X_SEED_MULTIPLIER = 6;
const BUBBLE_WOBBLE_Z_RADIANS_PER_UNIT = 1.5;
const BUBBLE_WOBBLE_Z_SEED_MULTIPLIER = 4;
const BUBBLE_WOBBLE_RADIUS = 0.22;

/**
 * Rim only, and a fade at both ends of the column.
 *
 * A bubble has no body — all you ever see of one is the ring where its surface
 * turns away from you — which is why the falloff power is higher than the
 * jellyfish's. The fades stop a bubble appearing at the vent or vanishing at the
 * top mid-frame; without them the stream pops.
 */
const BUBBLE_RIM_FALLOFF_POWER = 2.2;
const BUBBLE_FADE_OUT_START = 0.86;
const BUBBLE_FADE_IN_END = 0.04;
const BUBBLE_RIM_BRIGHTNESS = 1.5;
const BUBBLE_ALPHA_WEIGHT = 0.85;

export const BUBBLE_ANCHOR_ATTRIBUTE = "aBubbleAnchor";
export const BUBBLE_SEED_ATTRIBUTE = "aBubbleSeed";

const BUBBLE_TINT = "#DCF6FF";
const BUBBLE_DEFAULT_COLUMN_TOP = 40;

export function bubbleVertexShaderGlsl(): string {
  return /* glsl */ `
      attribute vec3 ${BUBBLE_ANCHOR_ATTRIBUTE};
      attribute float ${BUBBLE_SEED_ATTRIBUTE};
      uniform float uBubbleTime;
      uniform float uBubbleTop;
      varying float vRim;
      varying float vFade;
      void main(){
        float span = uBubbleTop;
        float rise = mod(uBubbleTime * ${BUBBLE_RISE_UNITS_PER_SECOND} + ${BUBBLE_ANCHOR_ATTRIBUTE}.y * span + ${BUBBLE_SEED_ATTRIBUTE}, span);
        float climb = rise / span;
        // A bubble expands as it rises: less pressure above it.
        float grow = 1.0 + climb * ${BUBBLE_EXPANSION_OVER_CLIMB};
        float bubbleRadius = (${BUBBLE_MINIMUM_RADIUS} + fract(${BUBBLE_SEED_ATTRIBUTE}) * ${BUBBLE_RADIUS_RANGE}) * grow;
        vec3 wobble = vec3(
          sin(rise * ${BUBBLE_WOBBLE_X_RADIANS_PER_UNIT} + ${BUBBLE_SEED_ATTRIBUTE} * ${BUBBLE_WOBBLE_X_SEED_MULTIPLIER}.0) * ${BUBBLE_WOBBLE_RADIUS} * grow, 0.0,
          cos(rise * ${BUBBLE_WOBBLE_Z_RADIANS_PER_UNIT} + ${BUBBLE_SEED_ATTRIBUTE} * ${BUBBLE_WOBBLE_Z_SEED_MULTIPLIER}.0) * ${BUBBLE_WOBBLE_RADIUS} * grow);
        vec3 world = vec3(${BUBBLE_ANCHOR_ATTRIBUTE}.x, rise, ${BUBBLE_ANCHOR_ATTRIBUTE}.z) + wobble + position * bubbleRadius;
        vec4 viewPosition = modelViewMatrix * vec4(world, 1.0);
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * position);
        vRim = pow(1.0 - abs(dot(viewNormal, normalize(-viewPosition.xyz))), ${BUBBLE_RIM_FALLOFF_POWER});
        // Fade in at the vent and out at the top, so nothing pops.
        vFade = smoothstep(1.0, ${BUBBLE_FADE_OUT_START}, climb) * smoothstep(0.0, ${BUBBLE_FADE_IN_END}, climb);
        gl_Position = projectionMatrix * viewPosition;
      }`;
}

export function bubbleFragmentShaderGlsl(): string {
  return /* glsl */ `
      uniform vec3 uBubbleTint;
      varying float vRim;
      varying float vFade;
      void main(){
        gl_FragColor = vec4(uBubbleTint * vRim * ${BUBBLE_RIM_BRIGHTNESS}, vRim * vFade * ${BUBBLE_ALPHA_WEIGHT});
        // Additive — see the header for why nothing is encoded.
      }`;
}

/** What `useFrame` keeps current, identically on both paths. */
export type BubbleFrameUniforms = {
  uBubbleTime: { value: number };
  uBubbleTop: { value: number };
  uBubbleTint: { value: Color };
};

function classicBubbleMaterial(): DrifterMaterial<BubbleFrameUniforms> {
  const uniforms: BubbleFrameUniforms = {
    uBubbleTime: { value: 0 },
    uBubbleTop: { value: BUBBLE_DEFAULT_COLUMN_TOP },
    uBubbleTint: { value: new Color(BUBBLE_TINT) }
  };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: bubbleVertexShaderGlsl(),
    fragmentShader: bubbleFragmentShaderGlsl()
  });
  return { material, uniforms };
}

/**
 * The node path.
 *
 * Same two facts as the jellyfish: `positionNode` replaces what the GLSL calls
 * `world` (it is local space despite the name, because the GLSL multiplies it by
 * `modelViewMatrix` afterwards), and the outward direction is the local position
 * rather than the normal attribute.
 *
 * The one difference from the bell is that the bubble does NOT normalise its
 * position before transforming it. `IcosahedronGeometry(1, 1)` is already unit
 * radius, so the two agree — and matching the GLSL exactly is worth more here
 * than tidying it, because the parity harness subtracts the frames.
 *
 * `positionGeometry` rather than `positionLocal`, for the reason the jellyfish
 * states at length: once `positionNode` is set, `positionLocal` is the deformed
 * result and the rim term built from it collapses into a filled disc.
 */
function nodeBubbleMaterial(modules: NodeMaterialModules): DrifterMaterial<BubbleFrameUniforms> {
  const { NodeMaterial } = modules.webgpu;
  const {
    abs,
    attribute,
    cos,
    dot,
    float,
    fract,
    mod,
    modelViewMatrix,
    normalize,
    positionGeometry,
    positionViewDirection,
    pow,
    sin,
    smoothstep,
    uniform,
    varying,
    vec3,
    vec4
  } = modules.tsl;

  const uBubbleTime = uniform(0);
  const uBubbleTop = uniform(BUBBLE_DEFAULT_COLUMN_TOP);
  const uBubbleTint = uniform(new Color(BUBBLE_TINT));

  const anchor = attribute(BUBBLE_ANCHOR_ATTRIBUTE, "vec3") as unknown as Node<"vec3">;
  const seed = attribute(BUBBLE_SEED_ATTRIBUTE, "float") as unknown as Node<"float">;

  const span = uBubbleTop;
  const rise = mod(uBubbleTime.mul(BUBBLE_RISE_UNITS_PER_SECOND).add(anchor.y.mul(span)).add(seed), span);
  const climb = rise.div(span);
  const grow = float(1).add(climb.mul(BUBBLE_EXPANSION_OVER_CLIMB));
  const bubbleRadius = float(BUBBLE_MINIMUM_RADIUS).add(fract(seed).mul(BUBBLE_RADIUS_RANGE)).mul(grow);

  const wobble = vec3(
    sin(rise.mul(BUBBLE_WOBBLE_X_RADIANS_PER_UNIT).add(seed.mul(BUBBLE_WOBBLE_X_SEED_MULTIPLIER)))
      .mul(BUBBLE_WOBBLE_RADIUS)
      .mul(grow),
    float(0),
    cos(rise.mul(BUBBLE_WOBBLE_Z_RADIANS_PER_UNIT).add(seed.mul(BUBBLE_WOBBLE_Z_SEED_MULTIPLIER)))
      .mul(BUBBLE_WOBBLE_RADIUS)
      .mul(grow)
  );

  const material = new NodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.fog = false;
  material.positionNode = vec3(anchor.x, rise, anchor.z).add(wobble).add(positionGeometry.mul(bubbleRadius));

  const viewNormal = normalize(modelViewMatrix.mul(vec4(positionGeometry, 0)).xyz);
  const rim = varying(
    pow(float(1).sub(abs(dot(viewNormal, positionViewDirection))), float(BUBBLE_RIM_FALLOFF_POWER))
  ) as unknown as Node<"float">;
  const fade = varying(
    smoothstep(float(1), float(BUBBLE_FADE_OUT_START), climb).mul(
      smoothstep(float(0), float(BUBBLE_FADE_IN_END), climb)
    )
  ) as unknown as Node<"float">;

  material.colorNode = vec4(
    uBubbleTint.mul(rim).mul(BUBBLE_RIM_BRIGHTNESS),
    rim.mul(fade).mul(BUBBLE_ALPHA_WEIGHT)
  );

  return {
    material: material as unknown as Material,
    uniforms: { uBubbleTime, uBubbleTop, uBubbleTint } as unknown as BubbleFrameUniforms
  };
}

/** The bubble stream's material for whichever renderer is drawing. */
export function bubbleMaterial(nodeModules: NodeMaterialModules | null): DrifterMaterial<BubbleFrameUniforms> {
  return nodeModules ? nodeBubbleMaterial(nodeModules) : classicBubbleMaterial();
}
