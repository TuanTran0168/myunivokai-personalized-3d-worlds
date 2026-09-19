import {
  AdditiveBlending,
  BackSide,
  Color,
  ShaderMaterial,
  Vector3,
  type Material
} from "three";
import type { Node } from "three/webgpu";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE SHAFTS OF LIGHT, IN BOTH SHADER LANGUAGES — AND THE MATERIAL THE
 * MIGRATION DELIBERATELY STOPPED AT.
 *
 * §26 Phase 8's last shader, and the only one in this app whose port was held
 * back by a question about the picture rather than about the API. That question
 * is answered below, on the record, because it is the interesting part of this
 * file and because the answer is not "they look the same".
 *
 * # What the layer is
 *
 * A 24-step volumetric raymarch on the inside of a sphere that follows the
 * camera, accumulating the MEAN rather than the sum — or the brightness would
 * track the step count instead of the water — with the noise sampled in the
 * plane PERPENDICULAR to the light. Sampled in world space it makes clouds;
 * only a cross-section makes ribbons, and only an anisotropic 4:1 cross-section
 * makes shafts rather than cotton balls.
 *
 * # THE TWO PATHS COMPOSITE IN DIFFERENT SPACES, AND THIS LAYER IS WHERE IT SHOWS
 *
 * The classic material writes `gl_FragColor` with no `<tonemapping_fragment>`
 * and no `<colorspace_fragment>`. It is additive, so it adds RAW LINEAR values
 * into a framebuffer that the opaque pass already wrote ACES-mapped and
 * sRGB-encoded. The node path cannot do that: `Renderer.needsFrameBufferTarget`
 * (`Renderer.js:2446`) is true whenever tone mapping is on or the output colour
 * space differs from the working one, both of which hold for this family, so
 * the renderer draws the whole scene into a LINEAR target and runs one output
 * transform over the composited result (`Renderer.js:1778`). **There is no
 * per-material opt-out from a frame-wide pass.**
 *
 * So for a linear backdrop `b` and a linear ray contribution `r`, with `E` the
 * frame's encode:
 *
 *     classic   E(b) + r          add after encoding
 *     node      E(b + r)          add before encoding
 *
 * # THE DECISION: PORT IT FAITHFULLY, ADD NO COMPENSATION SCALAR
 *
 * The tempting fix is a node-path strength multiplier that makes the two match.
 * It cannot exist, and the arithmetic says why rather than an opinion. Matching
 * needs `E(b + r') = E(b) + r`, so `r' ≈ r / E'(b)` — the correction is the
 * RECIPROCAL DERIVATIVE OF THE ENCODE AT THE BACKDROP, and the backdrop is
 * different in every pixel. For sRGB, `E'(x) = 0.4396 · x^(-0.5833)`:
 *
 *     backdrop 0.05 (deep water)     E' = 2.54
 *     backdrop 0.10 (midwater)       E' = 1.68
 *     backdrop 0.20 (lit shallows)   E' = 1.12
 *
 * A single scalar fits one of those rows and is wrong by more than a factor of
 * two at the others — in the same frame, since a shaft crosses all three. A
 * constant chosen to make one measurement agree is exactly the invented lever
 * §30.2 of the feasibility report warns about, and it would be dressed as
 * physics.
 *
 * **What the node path does is also the physically correct one.** Light adds in
 * linear; adding a linear quantity to an sRGB-encoded one is not a different
 * convention, it is an error that this scene's numbers were tuned against. The
 * shipped shader carries the receipt in its own comment history: the strength
 * was halved to 1.05 and put back to 2.2, and a hard 0.62 ceiling was added and
 * then removed once the renderer's ACES was back to do the roll-off "properly".
 * Both of those are the tuning of an additive layer against the encode it lands
 * in.
 *
 * **WHAT THE OWNER GETS, STATED PLAINLY.** On the node path the rays read
 * BRIGHTER than they do today, most in the darkest water, because that is where
 * `E'` is largest — and their tops read SOFTER, because ACES rolls off a sum
 * that the classic path let clip. If that is not wanted, the lever is one
 * number in the rig, `GOD_RAY_STRENGTH_MULTIPLE`, and lowering it costs the
 * classic path the same brightness it buys the node one, for as long as both
 * paths ship. There is no setting that changes only the new path.
 *
 * # What is NOT claimed
 *
 * The jitter cannot match across backends and is not expected to.
 * `gl_FragCoord` and TSL's `screenCoordinate` do not share a Y origin, and the
 * hash is chaotic in its input, so the same pixel gets a different offset. This
 * is deliberate noise whose job is to break 24-step banding into something the
 * eye reads as water; its STATISTICS carry the look, not its values. A parity
 * diff over this layer therefore has a floor above zero that no amount of
 * porting removes.
 */

// ---- the march -------------------------------------------------------------

/**
 * Steps through the volume. Coarse on purpose — the jitter below is what buys
 * back the banding this count would otherwise produce, far more cheaply than
 * more steps would.
 */
const MARCH_STEPS = 24;

/** The sphere the march happens inside, large enough to contain the far plane. */
const GOD_RAY_SPHERE_RADIUS = 120;
const GOD_RAY_SPHERE_WIDTH_SEGMENTS = 24;
const GOD_RAY_SPHERE_HEIGHT_SEGMENTS = 18;

/** How far the march reaches, as a multiple of the world's visible range. */
const MARCH_DISTANCE_RANGE_MULTIPLE = 1.8;

// ---- the noise field -------------------------------------------------------

/** The value-noise hash, spelled exactly as the shipped GLSL spells it. */
const HASH_DOT_X = 127.1;
const HASH_DOT_Y = 311.7;
const HASH_SCALE = 43758.5453123;

/** Four octaves of fbm: enough structure for a shaft, cheap enough for 24 steps. */
const FBM_OCTAVE_COUNT = 4;
const FBM_INITIAL_AMPLITUDE = 0.5;
/** Not 2.0. An exact doubling aligns every octave's lattice and the sum stripes. */
const FBM_LACUNARITY = 2.03;
const FBM_AMPLITUDE_FALLOFF = 0.5;

/**
 * The beam-plane lookup, and the one number that decides whether a shaft is a
 * shaft. ANISOTROPIC 4:1 — narrow along the beam's own axis, wide across it. An
 * isotropic scale gives a beam the same width as its length and every shaft
 * reads as a blob.
 */
const BEAM_PLANE_SCALE_ALONG = 0.3;
const BEAM_PLANE_SCALE_ACROSS = 0.075;

/** How fast the field drifts across the beam. Water moves; light through it does too. */
const BEAM_DRIFT_RATE = 0.02;

/** Threshold ABOVE the field's mean, or the whole volume glows instead of banding into shafts. */
const DENSITY_THRESHOLD_START = 0.52;
const DENSITY_THRESHOLD_END = 0.86;

/**
 * A second octave at its own finer scale rather than folded into the fbm
 * series. A shaft with one smooth field and nothing riding on top of it reads
 * as a gradient rather than as light moving through real water.
 */
const GRAIN_BASE = 0.62;
const GRAIN_AMPLITUDE = 0.38;
const GRAIN_FREQUENCY = 3.7;
const GRAIN_DRIFT_RATE = 0.05;

/**
 * The sample's OWN extinction path through the water column above it, which is
 * not what `uExtinction` measures — that one is scaled by distance from the
 * CAMERA, and a point directly below the surface has a short camera path and a
 * long column.
 */
const DEPTH_FADE_PER_METRE = 0.02;

// ---- what the rig hands over ----------------------------------------------

/**
 * Halved from the first port, then put back. At 2.2 an additive term over a
 * whole hemisphere is the one thing in this scene that can wash every other one
 * out — and at 1.05 the beams were never bright enough to read as separate from
 * the water, which is a diffuse glow where the prototype has a distinct shaft.
 */
const GOD_RAY_STRENGTH_MULTIPLE = 2.2;

/** Strength derived from world brightness when the scene config does not carry one. */
const GOD_RAY_BRIGHTNESS_EXPONENT = 1.3;

/** Below this the shafts are not visible and the whole layer is skipped. */
const GOD_RAY_VISIBILITY_STRENGTH_FLOOR = 0.004;

/** The shafts take the key light's colour, pulled toward a cold surface white. */
const GOD_RAY_SURFACE_WHITE = "#DCF6FF";
const GOD_RAY_SURFACE_WHITE_MIX = 0.35;

export {
  GOD_RAY_SPHERE_RADIUS,
  GOD_RAY_SPHERE_WIDTH_SEGMENTS,
  GOD_RAY_SPHERE_HEIGHT_SEGMENTS,
  GOD_RAY_VISIBILITY_STRENGTH_FLOOR,
  MARCH_DISTANCE_RANGE_MULTIPLE
};

/**
 * The uniform record, which stays the shape it has always been because the rig
 * writes into it every frame and from several places.
 */
export type GodRayUniformValues = {
  uTime: { value: number };
  uStrength: { value: number };
  uRayColor: { value: Color };
  uSunDirection: { value: Vector3 };
  uAxisA: { value: Vector3 };
  uAxisB: { value: Vector3 };
  uExtinction: { value: number };
  uMarchDistance: { value: number };
  uSurfaceY: { value: number };
};

export type GodRayInputs = {
  /** True when the camera is above the water, where there are no shafts to draw. */
  isAboveWater: boolean;
  /** `lighting.godRayStrength` when the world carries one. */
  configuredStrength?: number;
  /** The world's own brightness, which the strength falls back to. */
  brightness: number;
  /** The key light's colour, before the pull toward surface white. */
  keyColor: Color;
  /** The sun as seen from under the water. */
  sunBelow: Vector3;
  /** The water's extinction coefficient, shared with the fog. */
  extinction: number;
  /** The world's visible range, which sets how far the march reaches. */
  range: number;
  /** Where the surface is, in the rig's own vertical coordinates. */
  surfaceY: number;
};

/**
 * The uniform values, built in one place so the node arm and the classic arm
 * are provably reading the same numbers.
 */
export function godRayUniformValues(inputs: GodRayInputs): GodRayUniformValues {
  const strength = inputs.isAboveWater
    ? 0
    : (inputs.configuredStrength ?? Math.pow(inputs.brightness, GOD_RAY_BRIGHTNESS_EXPONENT)) *
      GOD_RAY_STRENGTH_MULTIPLE;
  return {
    uTime: { value: 0 },
    uStrength: { value: strength },
    uRayColor: {
      value: inputs.keyColor.clone().lerp(new Color(GOD_RAY_SURFACE_WHITE), GOD_RAY_SURFACE_WHITE_MIX)
    },
    uSunDirection: { value: inputs.sunBelow.clone() },
    uAxisA: { value: new Vector3(1, 0, 0) },
    uAxisB: { value: new Vector3(0, 0, 1) },
    uExtinction: { value: inputs.extinction },
    uMarchDistance: { value: inputs.range * MARCH_DISTANCE_RANGE_MULTIPLE },
    uSurfaceY: { value: inputs.surfaceY }
  };
}

export type GodRayMaterialSet = {
  material: Material;
  /**
   * Copies the rig's per-frame writes into the node uniforms.
   *
   * A no-op on the classic path, where the rig's own record IS the uniform set.
   * On the node path it is load-bearing for the same reason the caustics' one
   * is: a node uniform initialised at build time holds its placeholder forever,
   * and this layer's placeholder time is zero — a set of shafts frozen mid-drift
   * is a plausible still frame, not a blank one, and a screenshot cannot tell
   * the difference.
   */
  synchronise: () => void;
};

/** The shipped GLSL, moved between files without a character changing. */
function classicGodRayMaterial(uniforms: Record<string, { value: unknown }>): GodRayMaterialSet {
  const material = new ShaderMaterial({
    uniforms,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
    vertexShader: `varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uStrength; uniform vec3 uRayColor;
      uniform vec3 uSunDirection; uniform vec3 uAxisA; uniform vec3 uAxisB;
      uniform float uExtinction; uniform float uMarchDistance; uniform float uSurfaceY;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 dir = normalize(vW - cameraPosition);
        float accumulated = 0.0;
        const int STEPS = 24;
        float stepSize = 1.0 / float(STEPS);
        // Jittered per fragment rather than sampled at fixed offsets: 24
        // steps at a FIXED phase band exactly where a coarse march always
        // does, and the jitter spreads that banding into noise instead,
        // which the eye reads as water rather than as a rendering artifact.
        float jitter = hash(gl_FragCoord.xy) * stepSize;
        for (int i = 0; i < STEPS; i++){
          float t = jitter + float(i) * stepSize;
          vec3 p = cameraPosition + dir * t * uMarchDistance;
          if (p.y > uSurfaceY) continue;
          // Sampled in the plane across the beam, which is what turns a cloud
          // into a ribbon. ANISOTROPIC 4:1 — narrow along the beam's own axis
          // (A), wide across it (B) — is what turns that ribbon into a
          // shaft instead of a blob: an isotropic scale gives a beam the same
          // width as its length, and every shaft reads as a cotton ball.
          vec2 beamPlane = vec2(dot(p, uAxisA), dot(p, uAxisB));
          vec2 uv = beamPlane * vec2(0.30, 0.075) + vec2(uTime * 0.02, 0.0);
          float density = fbm(uv);
          // Threshold ABOVE the mean, or the whole volume glows.
          density = smoothstep(0.52, 0.86, density);
          // A second octave, sampled at its own finer scale rather than
          // folded into fbm's own series — a shaft with one smooth field and
          // nothing riding on top of it reads as a gradient, not as light
          // moving through real water.
          float grain = 0.62 + 0.38 * noise(uv * 3.7 + vec2(uTime * 0.05, 0.0));
          // Depth fade: independent of how far the CAMERA is from this point,
          // this is how far the point itself sits below the surface — its
          // own extinction path through the water column above it, which
          // uExtinction (scaled by march distance FROM THE CAMERA) does not
          // capture on its own.
          float fade = exp(-max(0.0, uSurfaceY - p.y) * 0.02);
          accumulated += density * grain * fade * exp(-t * uMarchDistance * uExtinction);
        }
        float mean = accumulated / float(STEPS);
        // Hard ceiling. This is additive and depth-tested off, so an unbounded
        // value here is the one thing in the scene able to paint over
        // everything else, and it did.
        // Unclamped. The 0.62 ceiling was a workaround for the composer having
        // disabled tone mapping, where anything past 1.0 clipped flat to white;
        // with the renderer's ACES back, its shoulder does that job properly and
        // the ceiling only flattens the top of every shaft.
        vec3 rays = uRayColor * mean * uStrength;
        gl_FragColor = vec4(rays, 1.0);
        // Additive, so raw linear: see oceanRigDrifters.ts. THIS is the layer
        // that made it obvious. Encoded, the rays clipped the entire visible
        // band of a 14 m reef to pure white — 100% of measured pixels — while
        // the camera happened to point away from them, so it went unseen until
        // the framing was corrected to look up along the shafts.
      }`
  });
  return { material, synchronise: () => {} };
}

/**
 * The same march as a node graph.
 *
 * `positionWorld` replaces the hand-built `vW` varying — the classic vertex
 * stage exists only to carry it — and `screenCoordinate` replaces
 * `gl_FragCoord.xy`, with the origin caveat in this file's header.
 */
function nodeGodRayMaterial(
  uniformValues: GodRayUniformValues,
  modules: NodeMaterialModules
): GodRayMaterialSet {
  const { NodeMaterial } = modules.webgpu;
  const {
    Continue,
    Fn,
    If,
    Loop,
    cameraPosition,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    screenCoordinate,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4
  } = modules.tsl;

  const material = new NodeMaterial();
  material.side = BackSide;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = AdditiveBlending;
  material.fog = false;

  // The vectors share the rig's own instances, so the rig's per-frame writes
  // into `uAxisA` and `uAxisB` are already visible here; only the scalars need
  // copying, and `synchronise` below does that.
  const elapsedSeconds = uniform(uniformValues.uTime.value);
  const strength = uniform(uniformValues.uStrength.value);
  const rayColor = uniform(uniformValues.uRayColor.value) as unknown as Node<"vec3">;
  const axisAlongBeam = uniform(uniformValues.uAxisA.value) as unknown as Node<"vec3">;
  const axisAcrossBeam = uniform(uniformValues.uAxisB.value) as unknown as Node<"vec3">;
  const extinction = uniform(uniformValues.uExtinction.value);
  const marchDistance = uniform(uniformValues.uMarchDistance.value);
  const surfaceY = uniform(uniformValues.uSurfaceY.value);

  const hash = Fn(([point]: [Node<"vec2">]) =>
    fract(sin(dot(point, vec2(HASH_DOT_X, HASH_DOT_Y))).mul(HASH_SCALE))
  );

  const valueNoise = Fn(([point]: [Node<"vec2">]) => {
    const lattice = floor(point);
    const withinCell = fract(point);
    const weight = withinCell.mul(withinCell).mul(float(3).sub(withinCell.mul(2)));
    return mix(
      mix(hash(lattice), hash(lattice.add(vec2(1, 0))), weight.x),
      mix(hash(lattice.add(vec2(0, 1))), hash(lattice.add(vec2(1, 1))), weight.x),
      weight.y
    );
  });

  const fractalNoise = Fn(([point]: [Node<"vec2">]) => {
    const accumulated = float(0).toVar();
    const amplitude = float(FBM_INITIAL_AMPLITUDE).toVar();
    const sample = vec2(point).toVar();
    Loop(FBM_OCTAVE_COUNT, () => {
      accumulated.addAssign(amplitude.mul(valueNoise(sample)));
      sample.mulAssign(FBM_LACUNARITY);
      amplitude.mulAssign(FBM_AMPLITUDE_FALLOFF);
    });
    return accumulated;
  });

  material.colorNode = Fn(() => {
    const direction = normalize(positionWorld.sub(cameraPosition));
    const accumulated = float(0).toVar();
    const stepSize = float(1 / MARCH_STEPS);
    const jitter = hash(screenCoordinate.xy).mul(stepSize);

    Loop(MARCH_STEPS, ({ i }: { i: Node<"int"> }) => {
      const alongRay = jitter.add(float(i).mul(stepSize));
      const samplePoint = cameraPosition.add(direction.mul(alongRay).mul(marchDistance));
      If(samplePoint.y.greaterThan(surfaceY), () => {
        Continue();
      });

      const beamPlane = vec2(dot(samplePoint, axisAlongBeam), dot(samplePoint, axisAcrossBeam));
      const lookup = beamPlane
        .mul(vec2(BEAM_PLANE_SCALE_ALONG, BEAM_PLANE_SCALE_ACROSS))
        .add(vec2(elapsedSeconds.mul(BEAM_DRIFT_RATE), float(0)));
      const density = smoothstep(
        float(DENSITY_THRESHOLD_START),
        float(DENSITY_THRESHOLD_END),
        fractalNoise(lookup)
      );
      const grain = float(GRAIN_BASE).add(
        valueNoise(lookup.mul(GRAIN_FREQUENCY).add(vec2(elapsedSeconds.mul(GRAIN_DRIFT_RATE), float(0)))).mul(
          GRAIN_AMPLITUDE
        )
      );
      const columnFade = exp(max(float(0), surfaceY.sub(samplePoint.y)).mul(-DEPTH_FADE_PER_METRE));
      const cameraPathFade = exp(alongRay.mul(marchDistance).mul(extinction).negate());
      accumulated.addAssign(density.mul(grain).mul(columnFade).mul(cameraPathFade));
    });

    const mean = accumulated.div(float(MARCH_STEPS));
    return vec4(rayColor.mul(mean).mul(strength), 1);
  })();

  return {
    material: material as unknown as Material,
    synchronise: () => {
      elapsedSeconds.value = uniformValues.uTime.value;
      strength.value = uniformValues.uStrength.value;
      extinction.value = uniformValues.uExtinction.value;
      marchDistance.value = uniformValues.uMarchDistance.value;
      surfaceY.value = uniformValues.uSurfaceY.value;
    }
  };
}

/** The shafts, for whichever renderer is drawing. */
export function oceanGodRayMaterial(
  uniformValues: GodRayUniformValues,
  nodeModules: NodeMaterialModules | null
): GodRayMaterialSet {
  if (nodeModules) {
    return nodeGodRayMaterial(uniformValues, nodeModules);
  }
  return classicGodRayMaterial(uniformValues as unknown as Record<string, { value: unknown }>);
}
