// `BufferGeometry` and `BufferAttribute` come from `three`, not from
// `three/webgpu`, even though the MATERIAL below comes from the node copy. Those
// are two separate copies of the library, so the classes are not the same class
// — but geometry is data the renderer reads through flag checks
// (`isBufferGeometry`), never through `instanceof`, and every geometry in this
// app already reaches the node renderer this way: R3F's `<bufferGeometry />`
// constructs `three`'s. Using the node copy here instead is what makes the
// declared type incompatible with the `<sprite geometry={...} />` prop.
import { AdditiveBlending, BufferAttribute, BufferGeometry } from "three";
import type { Node } from "three/webgpu";
import { perInstanceAttribute, type NodeMaterialModules } from "./nodeMaterials";

/**
 * THE STAR SPRITE, IN BOTH SHADER LANGUAGES, FROM ONE SET OF NUMBERS.
 *
 * §26 Phase 8, and §8.1's entry 8 — the one it rates HIGH complexity and HIGH
 * risk, for two reasons that turn out to be separable.
 *
 * **WHY §30.2 SAID THIS NEEDED A HAND-WRITTEN INSTANCED-QUAD REWRITE, AND WHY
 * IT NO LONGER DOES.** WebGPU has no point size in its specification at all —
 * `point-list` topology draws one-pixel points — so a sized star cannot be a
 * point primitive there, and §30.2 measured requests of 3, 9 and 27 pixels all
 * coming back as 1. That measurement still holds for a `Points` object. What
 * changed is that three now ships the quad expansion itself: on 0.185.1
 * `PointsNodeMaterial.setupVertex` dispatches on `builder.object.isPoints`, and
 * anything that is NOT a `Points` takes `setupVertexSprite`
 * (`PointsNodeMaterial.js:89`).
 *
 * **AND THE SIZING ARITHMETIC MATCHES OURS EXACTLY, which is the part worth
 * checking rather than hoping.** three's sprite path computes
 * `sizeNode × screenDPR × (0.5 × canvasHeightInLogicalUnits / -viewZ)`. The GLSL
 * below computes `starSize × (uPointScale / -mvPosition.z)` with
 * `uPointScale = canvasHeightInLogicalUnits × devicePixelRatio / 2`. Those are
 * the same expression, because both were written against the same convention —
 * three's own comment on that line reads *"follow WebGLRenderer's
 * implementation, and scale by half the canvas height in logical units"*, which
 * is the convention `SizedStarPoints` was already matching by hand. So
 * `sizeAttenuation` does the work and `sizeNode` carries the raw per-star size.
 *
 * **`pointUV` IS STILL UNUSABLE AND IS NOT USED.** `PointUVNode.generate()`
 * emits `gl_PointCoord` on every builder and Dawn rejects it. The sprite quad
 * carries its own `uv` attribute over [0,1], which is what `gl_PointCoord` was
 * standing in for. three's `pointUV` also flips Y; this shader's falloff is
 * radially symmetric and its two spike crosses are symmetric under y → −y
 * (`abs(x·y)` and `abs(x² − y²)`), so the orientation does not reach the image.
 *
 * **WHAT IS NOT SOLVED HERE: THE COLOUR-MANAGEMENT BYPASS.** The classic
 * material writes `gl_FragColor` with no `<colorspace_fragment>`, so the
 * authored hex reaches the framebuffer unconverted — deliberate, and the reason
 * `hexColorToUnitRgb` exists instead of `Color`. Whether the node path's output
 * handling reproduces that is a question for the parity harness rather than for
 * this comment, and it is the half of §8.1's HIGH risk that the sprite finding
 * does not touch.
 */

/** Quad UV is [0,1]; the falloff maths wants [-1,1] centred on the star. */
const QUAD_COORDINATE_SCALE = 2;
const QUAD_COORDINATE_OFFSET = 1;

/**
 * A tight gaussian core plus an inverse-square halo, which is how a star
 * actually images: photographed star glow falls off about 1/r², and the core is
 * the point-spread function of the optics. Windowed so the sprite's square edge
 * vanishes rather than cutting the halo off in a straight line.
 */
const CORE_GAUSSIAN_FALLOFF = 16;
const HALO_NUMERATOR = 0.03;
const HALO_SOFTENING = 0.03;
const HALO_WEIGHT = 0.6;
const EDGE_WINDOW_INNER = 0.6;
const EDGE_WINDOW_OUTER = 1;

/**
 * The 4+4-point cross that aperture edges produce. Real photographs show spikes
 * only on the very brightest stars, so `spikeStrength` is per layer and zero for
 * most of them.
 */
const SPIKE_CROSS_WIDTH = 28;
const SPIKE_CROSS_FALLOFF_POWER = 10;
const SPIKE_DIAGONAL_WEIGHT = 0.3;
/** cos(45°) = sin(45°): the diagonal cross is the straight one rotated 45°. */
const SPIKE_DIAGONAL_ROTATION = 0.7071;

const TWINKLE_BASE = 0.85;
const TWINKLE_AMPLITUDE = 0.15;
const TWINKLE_RADIANS_PER_SECOND = 1.4;

/**
 * Below this the sprite contributes less than a quarter of an 8-bit level, so
 * discarding is free brightness-wise and saves the blend.
 */
const MINIMUM_VISIBLE_INTENSITY = 0.008;

/** The radius past which the sprite is outside the star's disc entirely. */
const SPRITE_EDGE_DISTANCE = 1;

/**
 * **THE ONE THING A QUAD DOES NOT GET FOR FREE AND A POINT DOES: CLIPPING
 * BEHIND THE CAMERA.**
 *
 * These layers surround the viewer — an all-sky band puts roughly half its stars
 * BEHIND the camera at any moment — and a `Points` primitive whose view-space z
 * is positive is simply clipped away. A sprite is not: `setupVertexSprite`
 * offsets the quad's corners in CLIP space by `offset × mvp.w`, and as `w`
 * approaches zero the offset it has to add to reach a fixed screen size
 * approaches infinity. A star crossing the near plane therefore stops being a
 * star and becomes a quad the size of the screen.
 *
 * Measured, not reasoned about after the fact: porting these layers without this
 * mask took the universe's parity divergence from **12.19 to 151.84** of 255,
 * with 98% of pixels differing, and the frame is a flat wash of one star's
 * colour. `e2e/shots/node-path-diagnostic/` has the picture.
 *
 * The mask collapses the quad to zero size instead, which is the same outcome
 * the point path gets from the clipper. The threshold is a small negative rather
 * than zero so a star sitting exactly on the plane is excluded too.
 */
const MINIMUM_VIEW_DEPTH_IN_FRONT_OF_CAMERA = -0.001;
const SPRITE_COLLAPSED_SIZE = 0;
const SPRITE_FULL_SIZE = 1;

/**
 * Alpha stays 1: with additive blending the contribution is `rgb * alpha`, so
 * baking the intensity into rgb keeps the falloff linear instead of squared.
 */
const ADDITIVE_SPRITE_ALPHA = 1;

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

export const STAR_POINTS_VERTEX_SHADER = /* glsl */ `
  attribute float starSize;
  attribute vec3 starColor;
  attribute float twinklePhase;
  uniform float uPointScale;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vStarColor = starColor;
    vTwinklePhase = twinklePhase;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = starSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Built from the constants above rather than written out, so that tuning one
 * moves both implementations. `sizedStarPointsMaterial.test.ts` asserts this
 * text contains no numeric literal the module does not declare.
 */
export function starPointsFragmentShaderGlsl(): string {
  return /* glsl */ `
  uniform float uTimeSeconds;
  uniform float uGlobalOpacity;
  uniform float uSpikeStrength;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vec2 offsetFromCenter = gl_PointCoord * ${QUAD_COORDINATE_SCALE}.0 - ${QUAD_COORDINATE_OFFSET}.0;
    float normalizedDistance = length(offsetFromCenter);
    if (normalizedDistance > ${SPRITE_EDGE_DISTANCE}.0) {
      discard;
    }
    float coreIntensity = exp(-normalizedDistance * normalizedDistance * ${CORE_GAUSSIAN_FALLOFF}.0);
    float edgeWindow = 1.0 - smoothstep(${EDGE_WINDOW_INNER}, ${EDGE_WINDOW_OUTER}.0, normalizedDistance);
    float haloIntensity = (${HALO_NUMERATOR} / (normalizedDistance * normalizedDistance + ${HALO_SOFTENING})) * edgeWindow;
    float spikeIntensity = 0.0;
    if (uSpikeStrength > 0.0) {
      float straightCross = pow(max(0.0, 1.0 - abs(offsetFromCenter.x * offsetFromCenter.y) * ${SPIKE_CROSS_WIDTH}.0), ${SPIKE_CROSS_FALLOFF_POWER}.0);
      vec2 diagonalCoord = vec2(
        offsetFromCenter.x + offsetFromCenter.y,
        offsetFromCenter.x - offsetFromCenter.y
      ) * ${SPIKE_DIAGONAL_ROTATION};
      float diagonalCross = pow(max(0.0, 1.0 - abs(diagonalCoord.x * diagonalCoord.y) * ${SPIKE_CROSS_WIDTH}.0), ${SPIKE_CROSS_FALLOFF_POWER}.0);
      spikeIntensity = (straightCross + ${SPIKE_DIAGONAL_WEIGHT} * diagonalCross) * (1.0 - normalizedDistance) * uSpikeStrength;
    }
    float twinkle = ${TWINKLE_BASE} + ${TWINKLE_AMPLITUDE} * sin(uTimeSeconds * ${TWINKLE_RADIANS_PER_SECOND} + vTwinklePhase);
    float intensity = (coreIntensity + ${HALO_WEIGHT} * haloIntensity + spikeIntensity) * twinkle * uGlobalOpacity;
    if (intensity < ${MINIMUM_VISIBLE_INTENSITY}) {
      discard;
    }
    gl_FragColor = vec4(vStarColor * intensity, ${ADDITIVE_SPRITE_ALPHA}.0);
  }
`;
}

export type StarLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  twinklePhases: Float32Array;
};

/** The three values `useFrame` keeps current without rebuilding the material. */
export type StarPointsFrameUniforms = {
  timeSeconds: { value: number };
  globalOpacity: { value: number };
  spikeStrength: { value: number };
};

export type StarPointsNodeLayer = {
  /** A `Sprite`'s own quad, not the module-level one three shares between all sprites. */
  geometry: BufferGeometry;
  material: InstanceType<NodeMaterialModules["webgpu"]["PointsNodeMaterial"]>;
  instanceCount: number;
  uniforms: StarPointsFrameUniforms;
};

/**
 * The node path: one instanced `Sprite` quad per star, sized by three.
 *
 * **THE GEOMETRY IS THIS LAYER'S OWN, AND THAT IS NOT TIDINESS.** `Sprite`
 * assigns a MODULE-LEVEL shared quad (`Sprite.js:69-93`) to every instance it
 * constructs. Attaching anything to it would attach it to every other sprite in
 * the process.
 *
 * The per-star values are standalone instanced attributes rather than geometry
 * attributes, which is the same shape three's own `Instance.js` uses, and each
 * is wrapped in a varying: an instanced attribute is a VERTEX-stage input, and
 * the fragment needs the colour and the twinkle phase.
 */
export function buildStarPointsNodeLayer(
  modules: NodeMaterialModules,
  stars: StarLayerAttributes,
  spikeStrength: number
): StarPointsNodeLayer {
  const { PointsNodeMaterial } = modules.webgpu;
  const {
    Discard,
    Fn,
    abs,
    exp,
    float,
    instancedBufferAttribute,
    max,
    positionView,
    sin,
    smoothstep,
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

  // `perInstanceAttribute` rather than `new BufferAttribute`, and the difference
  // is the whole reason the first attempt at this file rendered a white frame.
  // Its doc comment has the three lines in three that have to agree.
  const starCentre = instancedBufferAttribute(perInstanceAttribute(stars.positions, POSITION_COMPONENTS), "vec3");
  // Cast for the same reason `NodePostEffects.tsx` casts: TSL declares these
  // builders as returning a bare `Node<string>`, so the vector width has to be
  // restated even though the runtime value already carries it.
  const starColor = varying(
    instancedBufferAttribute(perInstanceAttribute(stars.colors, COLOR_COMPONENTS), "vec3")
  ) as unknown as Node<"vec3">;
  const starSize = instancedBufferAttribute(
    perInstanceAttribute(stars.sizes, SCALAR_COMPONENTS),
    "float"
  ) as unknown as Node<"float">;
  const twinklePhase = varying(
    instancedBufferAttribute(perInstanceAttribute(stars.twinklePhases, SCALAR_COMPONENTS), "float")
  ) as unknown as Node<"float">;

  const timeSeconds = uniform(0);
  const globalOpacity = uniform(1);
  const spikeStrengthUniform = uniform(spikeStrength);

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending
  });

  material.positionNode = starCentre;
  // `sizeNode` is a vec2 (width, height in pixels) and the star is square.
  // `sizeAttenuation` defaults to true on `PointsMaterial`, which is what
  // supplies the `0.5 × canvasHeight / -viewZ` the GLSL spells out by hand.
  // The mask is the near-plane clipping a quad does not inherit — see
  // MINIMUM_VIEW_DEPTH_IN_FRONT_OF_CAMERA.
  const inFrontOfCamera = positionView.z
    .lessThan(MINIMUM_VIEW_DEPTH_IN_FRONT_OF_CAMERA)
    .select(float(SPRITE_FULL_SIZE), float(SPRITE_COLLAPSED_SIZE));
  const maskedSize = starSize.mul(inFrontOfCamera);
  material.sizeNode = vec2(maskedSize, maskedSize);

  material.colorNode = Fn(() => {
    const offsetFromCentre = uv().mul(QUAD_COORDINATE_SCALE).sub(QUAD_COORDINATE_OFFSET);
    const normalizedDistance = offsetFromCentre.length();
    Discard(normalizedDistance.greaterThan(SPRITE_EDGE_DISTANCE));

    const squaredDistance = normalizedDistance.mul(normalizedDistance);
    const coreIntensity = exp(squaredDistance.mul(-CORE_GAUSSIAN_FALLOFF));
    const edgeWindow = float(1).sub(smoothstep(EDGE_WINDOW_INNER, EDGE_WINDOW_OUTER, normalizedDistance));
    const haloIntensity = float(HALO_NUMERATOR).div(squaredDistance.add(HALO_SOFTENING)).mul(edgeWindow);

    // The GLSL guards this whole block behind `if (uSpikeStrength > 0.0)`. That
    // is a branch for speed, not for maths: every term below is multiplied by
    // the same uniform, so a zero strength contributes nothing either way. A
    // node graph has no preprocessor and a uniform branch would cost more than
    // the arithmetic it skips.
    const crossProduct = abs(offsetFromCentre.x.mul(offsetFromCentre.y));
    const straightCross = max(float(0), float(1).sub(crossProduct.mul(SPIKE_CROSS_WIDTH))).pow(
      SPIKE_CROSS_FALLOFF_POWER
    );
    const diagonalCoordinate = vec2(
      offsetFromCentre.x.add(offsetFromCentre.y),
      offsetFromCentre.x.sub(offsetFromCentre.y)
    ).mul(SPIKE_DIAGONAL_ROTATION);
    const diagonalProduct = abs(diagonalCoordinate.x.mul(diagonalCoordinate.y));
    const diagonalCross = max(float(0), float(1).sub(diagonalProduct.mul(SPIKE_CROSS_WIDTH))).pow(
      SPIKE_CROSS_FALLOFF_POWER
    );
    const spikeIntensity = straightCross
      .add(diagonalCross.mul(SPIKE_DIAGONAL_WEIGHT))
      .mul(float(1).sub(normalizedDistance))
      .mul(spikeStrengthUniform);

    const twinkle = float(TWINKLE_BASE).add(
      sin(timeSeconds.mul(TWINKLE_RADIANS_PER_SECOND).add(twinklePhase)).mul(TWINKLE_AMPLITUDE)
    );
    const intensity = coreIntensity
      .add(haloIntensity.mul(HALO_WEIGHT))
      .add(spikeIntensity)
      .mul(twinkle)
      .mul(globalOpacity);
    Discard(intensity.lessThan(MINIMUM_VISIBLE_INTENSITY));

    return vec4(vec3(starColor).mul(intensity), ADDITIVE_SPRITE_ALPHA);
  })();

  return {
    geometry,
    material,
    instanceCount: stars.sizes.length,
    uniforms: {
      timeSeconds,
      globalOpacity,
      spikeStrength: spikeStrengthUniform
    }
  };
}
