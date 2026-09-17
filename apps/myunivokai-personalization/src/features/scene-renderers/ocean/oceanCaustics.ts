import { Color, type MeshStandardMaterial, type IUniform } from "three";
import type { Node } from "three/webgpu";
import {
  applyClassicShaderPatch,
  requireShaderChunks,
  SHADER_CHUNK_MARKERS
} from "@/features/scene-renderers/shared/shaderChunkPatch";
import {
  addNodeMaterialChunkPatch,
  type NodeMaterialChunkPatch
} from "@/features/scene-renderers/shared/nodeMaterialChunkPatch";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * Caustics on the seabed, by refraction rather than by noise.
 *
 * The version this replaces multiplied three sine gratings together and kept
 * the crests. It moved, and it was wrong in the way that matters: caustics are
 * not a pattern on the floor, they are *where the light went*. Sunlight enters
 * a wavy surface, each patch of wavefront is bent by the local slope, and the
 * bright veins are the places where neighbouring rays converge — the same light
 * arriving on less floor.
 *
 * Evan Wallace's WebGL water renders that literally: draw the surface as a grid,
 * push every vertex to where its refracted ray lands on the floor, and shade it
 * by `oldArea / newArea` taken from screen-space derivatives, accumulating
 * additively. That needs a second render target and a second scene.
 *
 * This computes the same quantity analytically. The wave field is known in
 * closed form, so the refracted landing point is a function of floor position,
 * and the area ratio is the reciprocal of the Jacobian determinant of that
 * function — which `dFdx`/`dFdy` give directly, for free, in the floor's own
 * fragment shader. One material, no extra pass, and the bright veins fall where
 * the light actually converges.
 *
 * Two consequences worth knowing:
 *
 *   - **It reaches zero on its own.** The strength is the depth curve's
 *     causticStrength, which is the surviving light fraction times a gain and is
 *     exactly zero below the sunlight floor. No branch says "the abyss has no
 *     caustics"; the arithmetic does.
 *   - **The refraction index is real.** 1.0/1.333 is air into water, and it is
 *     what sets how far a given slope throws its light. Treating it as a tuning
 *     knob is how caustics stop tracking the surface they supposedly come from.
 */

const WATER_REFRACTION_RATIO = 1.0 / 1.333;

/**
 * THE NODE PATH'S COPY OF EVERY NUMBER IN THE GLSL BELOW, AND WHY THE GLSL IS
 * NOT GENERATED FROM THEM.
 *
 * §26 Phase 7. Every other port in this migration builds its GLSL from the
 * constants so the two implementations cannot drift. This one does not, and the
 * reason is the risk asymmetry rather than a different opinion about style.
 *
 * The shader below is the most heavily tuned string in the app — five ripple
 * trains, a domain warp, a Jacobian clamp and a normalisation, each of which has
 * a paragraph above it recording a frame that was wrong before the number
 * moved. It is also what EVERY VISITOR RENDERS TODAY. Rebuilding it as a
 * template would put a thousand characters of whitespace-sensitive string
 * assembly between the seabed and the thing that has shipped, in exchange for
 * tidiness in a file nobody tunes twice. So the literal stays byte for byte, and
 * `oceanCaustics.test.ts` asserts that every constant declared here still
 * appears in it — which is the same anti-drift guarantee from the other
 * direction: a number tuned in one place and not the other fails a unit test.
 *
 * Wavelengths are in scene units and these are RIPPLES, not swell — see the
 * comment on RIPPLE_A in the shader for what getting that scale wrong looks
 * like.
 */
const RIPPLE_WAVENUMBER_FIRST = 2.4;
const RIPPLE_WAVENUMBER_SECOND = 1.7;
const RIPPLE_WAVENUMBER_THIRD = 3.9;
/** The two short trains, as multiples of the third rather than free numbers. */
const RIPPLE_WAVENUMBER_FOURTH_MULTIPLE = 1.61;
const RIPPLE_WAVENUMBER_FIFTH_MULTIPLE = 2.43;

/**
 * The domain warp: one wave far longer than any ripple, bending the coordinate
 * system so the five trains' maxima never land on the same lattice twice.
 */
const WARP_ACROSS_WAVENUMBER = 0.31;
const WARP_ACROSS_TIME_RATE = 0.13;
const WARP_SECOND_WEIGHT = 0.45;
const WARP_ACROSS_SECOND_WAVENUMBER = 0.71;
const WARP_ACROSS_SECOND_TIME_RATE = 0.19;
const WARP_ALONG_WAVENUMBER = 0.27;
const WARP_ALONG_TIME_RATE = 0.11;
const WARP_ALONG_SECOND_WAVENUMBER = 0.63;
const WARP_ALONG_SECOND_TIME_RATE = 0.17;
const WARP_AMPLITUDE = 1.5;

/**
 * The five trains, each a direction with a slope amplitude and a drift rate.
 *
 * The DIRECTIONS are the load-bearing part: three trains at 9, 68 and 135
 * degrees share no lattice, and the two extra carry the short end of the
 * spectrum that gives the veins their frayed edges. A negative drift rate is a
 * train running the other way, which is what the shader's `- t *` spells.
 */
const RIPPLE_TRAINS = [
  { directionX: 0.986, directionY: 0.164, slopeAmplitude: 0.26, wavenumber: RIPPLE_WAVENUMBER_FIRST, driftRate: 0.9 },
  { directionX: 0.383, directionY: 0.924, slopeAmplitude: 0.17, wavenumber: RIPPLE_WAVENUMBER_SECOND, driftRate: -0.7 },
  { directionX: -0.707, directionY: 0.707, slopeAmplitude: 0.11, wavenumber: RIPPLE_WAVENUMBER_THIRD, driftRate: 1.3 },
  {
    directionX: 0.643,
    directionY: -0.766,
    slopeAmplitude: 0.09,
    wavenumber: RIPPLE_WAVENUMBER_THIRD * RIPPLE_WAVENUMBER_FOURTH_MULTIPLE,
    driftRate: -1.7
  },
  {
    directionX: -0.259,
    directionY: -0.966,
    slopeAmplitude: 0.06,
    wavenumber: RIPPLE_WAVENUMBER_THIRD * RIPPLE_WAVENUMBER_FIFTH_MULTIPLE,
    driftRate: 2.1
  }
] as const;

/** The whole field is a slope, and this is its overall scale. */
const RIPPLE_SLOPE_SCALE = 0.16;

/**
 * The Jacobian's floor, its ceiling and its shape.
 *
 * The floor stops a division by a near-singular determinant. The ceiling is 1.8
 * and not 4 because at 4 a focus saturated every channel and the sand's grain,
 * the rock's shading and the plant's colour all vanished under one white ribbon.
 * The normalisation by the same 1.8 is what makes the strength uniform mean the
 * same thing here as in the prototype.
 */
const CAUSTIC_AREA_FLOOR = 1e-7;
const CAUSTIC_CONVERGENCE_BASELINE = 1;
const CAUSTIC_CEILING = 1.8;
const CAUSTIC_POWER = 1.6;

/**
 * Only upward-facing surfaces catch the light, which is both the physics and
 * the fix for a numerical trap: on a face seen edge-on both areas are near zero
 * and their ratio is noise, so kelp blades and rock walls would sparkle.
 */
const CAUSTIC_UPNESS_FADE_START = 0;
const CAUSTIC_UPNESS_FADE_END = 0.35;

/** The same four values as TSL nodes. */
export type CausticsUniformNodes = {
  time: Node<"float">;
  strength: Node<"float">;
  depth: Node<"float">;
  color: Node<"color">;
};

export type CausticsUniforms = {
  uCausticTime: IUniform<number>;
  uCausticStrength: IUniform<number>;
  uCausticDepth: IUniform<number>;
  uCausticColor: IUniform<Color>;
  /** Null on the classic path, which is every visitor today. */
  nodes: CausticsUniformNodes | null;
  /**
   * Copies the four classic values into their node twins. A no-op on the
   * classic path.
   *
   * **THE CLASSIC UNIFORMS ARE THE SOURCE OF TRUTH AND THIS IS WHY THERE IS A
   * COPY STEP AT ALL.** Three of these four are REASSIGNED after the material
   * exists — `tintSeabed` writes strength, colour and depth once the world's
   * water and lighting are known, and the frame loop writes the clock every
   * frame. A node uniform initialised from the same number at build time would
   * hold the placeholder forever: strength would stay 0, and the seabed would
   * render with no caustics at all on the node path while looking entirely
   * correct on the classic one. The colour is the exception — `uniform()` is
   * given the same `Color` INSTANCE, and `tintSeabed` mutates it in place — but
   * it is copied here too rather than relying on that, because which of the four
   * happens to be mutated in place is not a fact worth depending on.
   */
  synchronise: () => void;
  /**
   * The node-path injection, or null on the classic path.
   *
   * Handed back as a factory rather than a built patch so nothing constructs a
   * node graph for a material that will never use one — and so `applyCaustics`
   * keeps its two-argument shape, which is what leaves its three call sites
   * untouched.
   */
  nodePatch: (() => NodeMaterialChunkPatch) | null;
};

export function createCausticsUniforms(
  strength: number,
  surfaceHeightAboveFloor: number,
  lightColor: string,
  nodeModules: NodeMaterialModules | null
): CausticsUniforms {
  const uCausticTime: IUniform<number> = { value: 0 };
  const uCausticStrength: IUniform<number> = { value: strength };
  // How far the light travels between surface and floor. Deeper water spreads
  // the same slope over more floor, so the veins grow wider and softer with
  // depth on their own.
  const uCausticDepth: IUniform<number> = { value: Math.max(0.5, surfaceHeightAboveFloor) };
  const uCausticColor: IUniform<Color> = { value: new Color(lightColor) };

  if (!nodeModules) {
    return {
      uCausticTime,
      uCausticStrength,
      uCausticDepth,
      uCausticColor,
      nodes: null,
      synchronise: () => {},
      nodePatch: null
    };
  }

  const { uniform } = nodeModules.tsl;
  const time = uniform(uCausticTime.value);
  const strengthNode = uniform(uCausticStrength.value);
  const depth = uniform(uCausticDepth.value);
  const color = uniform(uCausticColor.value);

  return {
    uCausticTime,
    uCausticStrength,
    uCausticDepth,
    uCausticColor,
    nodes: {
      time: time as unknown as Node<"float">,
      strength: strengthNode as unknown as Node<"float">,
      depth: depth as unknown as Node<"float">,
      color: color as unknown as Node<"color">
    },
    synchronise: () => {
      time.value = uCausticTime.value;
      strengthNode.value = uCausticStrength.value;
      depth.value = uCausticDepth.value;
      color.value.copy(uCausticColor.value);
    },
    nodePatch: () =>
      causticsChunkPatch(nodeModules, {
        time: time as unknown as Node<"float">,
        strength: strengthNode as unknown as Node<"float">,
        depth: depth as unknown as Node<"float">,
        color: color as unknown as Node<"color">
      })
  };
}

/**
 * The same caustics as a node graph, and it is SHORTER than the GLSL for one
 * reason worth stating.
 *
 * The classic patch spends its whole vertex stage hand-computing a world
 * position and a world normal, with an `#ifdef USE_INSTANCING` branch, because
 * three's own `<worldpos_vertex>` hides its `worldPosition` behind
 * `#if defined(USE_ENVMAP) || ...` and may not emit it at all. On the node path
 * `positionWorld` and `normalWorld` are always available and are already
 * instanced — `Instance.js:213` and `:237` assign through `positionLocal` and
 * `normalLocal`, which both derive from. So the two varyings, the instancing
 * branch and the whole vertex injection disappear, and what is left is the
 * fragment arithmetic.
 *
 * **ONE THING THE NODE PATH DOES NOT EXPRESS: the early-out.** The GLSL wraps
 * everything in `if (uCausticStrength > 0.0001)`, which skips the derivative
 * work in water too deep for caustics. Here the arithmetic always runs and is
 * multiplied by a strength of zero, which gives the same pixel and costs more.
 * It is left that way deliberately: the branch is an optimisation rather than
 * part of the result, and Phase 11 is where a measured optimisation belongs.
 * Nothing here can go NaN with strength at zero — `excess` is clamped
 * non-negative and the divisor has a floor — so the multiply is safe.
 */
function causticsChunkPatch(modules: NodeMaterialModules, nodes: CausticsUniformNodes): NodeMaterialChunkPatch {
  const { abs, cos, dFdx, dFdy, dot, float, max, min, normalWorld, positionWorld, pow, sin, smoothstep, vec2, vec3 } =
    modules.tsl;

  /**
   * The surface's slope field: a domain warp, then five directional trains.
   *
   * The warp is not a refinement. A sum of plane waves is quasi-periodic however
   * many are added, their maxima land on a lattice, and the eye reads that
   * lattice instantly — three trains gave rectangles and then rows of rounded
   * cells. Bending the coordinates first slides the lattice's phase around as it
   * crosses the floor so it never lines up with itself twice.
   */
  function rippleSlope(floorPoint: Node<"vec2">, time: Node<"float">): Node<"vec2"> {
    const warp = vec2(
      sin(floorPoint.y.mul(WARP_ACROSS_WAVENUMBER).add(time.mul(WARP_ACROSS_TIME_RATE))).add(
        sin(floorPoint.x.mul(WARP_ACROSS_SECOND_WAVENUMBER).sub(time.mul(WARP_ACROSS_SECOND_TIME_RATE))).mul(
          WARP_SECOND_WEIGHT
        )
      ),
      cos(floorPoint.x.mul(WARP_ALONG_WAVENUMBER).sub(time.mul(WARP_ALONG_TIME_RATE))).add(
        cos(floorPoint.y.mul(WARP_ALONG_SECOND_WAVENUMBER).add(time.mul(WARP_ALONG_SECOND_TIME_RATE))).mul(
          WARP_SECOND_WEIGHT
        )
      )
    ).mul(WARP_AMPLITUDE);
    const warped = floorPoint.add(warp);

    let slope = vec2(0, 0) as unknown as Node<"vec2">;
    for (const train of RIPPLE_TRAINS) {
      const direction = vec2(train.directionX, train.directionY);
      const phase = dot(warped, direction).mul(train.wavenumber).add(time.mul(train.driftRate));
      slope = slope.add(direction.mul(cos(phase).mul(train.slopeAmplitude))) as unknown as Node<"vec2">;
    }
    return slope.mul(RIPPLE_SLOPE_SCALE) as unknown as Node<"vec2">;
  }

  return {
    name: "oceanCaustics",
    litColorAdjustment: (litColor) => {
      const floorPoint = vec2(positionWorld.x, positionWorld.z) as unknown as Node<"vec2">;
      // The deflection, written the way the shader writes it: the GLSL embeds
      // the ratio at six decimals, so the same six are used here rather than
      // the full double — the two paths must agree on the number, not on which
      // of them is more precise.
      const deflection = 1 - Number(WATER_REFRACTION_RATIO.toFixed(6));
      const origin = floorPoint.sub(rippleSlope(floorPoint, nodes.time).mul(deflection).mul(nodes.depth));

      // The area ratio, straight from screen-space derivatives: how much floor a
      // patch of wavefront covers now against how much it covered at the
      // surface. Above 1 the rays converged and the floor is bright.
      const originAcross = dFdx(origin);
      const originAlong = dFdy(origin);
      const newArea = abs(originAcross.x.mul(originAlong.y).sub(originAcross.y.mul(originAlong.x)));
      const floorAcross = dFdx(floorPoint);
      const floorAlong = dFdy(floorPoint);
      const oldArea = abs(floorAcross.x.mul(floorAlong.y).sub(floorAcross.y.mul(floorAlong.x)));

      const convergence = oldArea.div(max(newArea, float(CAUSTIC_AREA_FLOOR)));
      // Only convergence brightens; divergence is already the unlit floor, and
      // subtracting there would punch holes rather than dim gently.
      const excess = max(float(0), convergence.sub(float(CAUSTIC_CONVERGENCE_BASELINE)));
      const shaped = min(float(CAUSTIC_CEILING), pow(excess, float(CAUSTIC_POWER))).div(float(CAUSTIC_CEILING));
      const caustic = shaped.mul(
        smoothstep(float(CAUSTIC_UPNESS_FADE_START), float(CAUSTIC_UPNESS_FADE_END), normalWorld.y)
      );

      // `uniform(Color)` has node type "color", which is a vec3 everywhere it
      // matters and a distinct type to the checker. The cast says so once.
      const causticColor = nodes.color as unknown as Node<"vec3">;
      return litColor.add(causticColor.mul(caustic).mul(nodes.strength)) as unknown as Node<"vec3">;
    }
  };
}

const CAUSTICS_CHUNK = /* glsl */ `
  uniform float uCausticTime;
  uniform float uCausticStrength;
  uniform float uCausticDepth;
  uniform vec3 uCausticColor;
  varying vec3 vCausticWorldPosition;
  varying float vCausticUpness;

  // Wavelengths in scene units. These are RIPPLES, not swell — the small,
  // steep, wind-driven chop that rides on top of the waves the surface plane
  // draws, with crests a metre or two apart.
  //
  // Getting this wrong is invisible in the maths and glaring on screen. The
  // first draft used swell wavelengths of thirteen to forty-eight units inside
  // a basin thirty-six units across, so the "caustic net" was one or two
  // enormous pale swathes drifting over the seabed: the arithmetic was right
  // and the scale was off by an order of magnitude. Caustic veins on a real
  // reef floor are tens of centimetres wide, and it is their FINENESS against
  // the sand that makes them read as light rather than as bad lighting.
  const float RIPPLE_A = 2.4;
  const float RIPPLE_B = 1.7;
  const float RIPPLE_C = 3.9;

  /**
   * The surface height field, as three ripple trains running in three
   * directions.
   *
   * The DIRECTIONS are the load-bearing part. A draft that summed an x-only
   * grating and a y-only grating produced a caustic net of perfect rectangles —
   * arithmetically a caustic, visually a tiled floor, and worse than the blobs
   * it replaced because a grid is the one pattern the eye never forgives.
   *
   * Real chop runs whichever way the wind and the reflected swell send it, and
   * three trains at 9, 68 and 135 degrees share no lattice, so their crests
   * cross at angles that keep changing across the floor. That is what turns the
   * net into the irregular polygons a real seabed shows.
   *
   * The gradient is what matters here, not the height — the height is never
   * displayed. So the amplitudes below are SLOPES, and each train contributes
   * along its own direction, which is what the gradient of a directional
   * sinusoid actually is.
   */
  vec2 surfaceSlope(vec2 p, float t) {
    // DOMAIN WARP, and it is not a refinement — it is the difference between a
    // caustic and a tiled floor.
    //
    // A sum of plane waves is quasi-periodic no matter how many are added or
    // how carefully their angles are chosen: their maxima land on a lattice,
    // and the eye reads that lattice instantly. Three trains gave rectangles,
    // then rows of rounded cells; the pattern was fine, regular and obviously
    // manufactured. Bending the coordinate system first, with a wave far longer
    // than any ripple, slides the lattice's phase around as it crosses the
    // floor so it never lines up with itself twice.
    //
    // The warp changes the true gradient by a chain-rule factor that is not
    // accounted for here, and that is fine: the Jacobian this field feeds is
    // measured downstream with dFdx/dFdy on the RESULT, so it stays consistent
    // with whatever field it is actually given.
    vec2 warped = p + vec2(
      sin(p.y * 0.31 + t * 0.13) + 0.45 * sin(p.x * 0.71 - t * 0.19),
      cos(p.x * 0.27 - t * 0.11) + 0.45 * cos(p.y * 0.63 + t * 0.17)
    ) * 1.5;

    // Five trains rather than three. The two extra carry the short end of the
    // spectrum, which is what gives the veins their frayed edges — a real
    // surface is broadband, and a caustic drawn from three clean tones looks
    // exactly as synthetic as it is.
    vec2 firstDirection = vec2(0.986, 0.164);
    vec2 secondDirection = vec2(0.383, 0.924);
    vec2 thirdDirection = vec2(-0.707, 0.707);
    vec2 fourthDirection = vec2(0.643, -0.766);
    vec2 fifthDirection = vec2(-0.259, -0.966);
    vec2 slope = vec2(0.0);
    slope += firstDirection * (0.26 * cos(dot(warped, firstDirection) * RIPPLE_A + t * 0.9));
    slope += secondDirection * (0.17 * cos(dot(warped, secondDirection) * RIPPLE_B - t * 0.7));
    slope += thirdDirection * (0.11 * cos(dot(warped, thirdDirection) * RIPPLE_C + t * 1.3));
    slope += fourthDirection * (0.09 * cos(dot(warped, fourthDirection) * RIPPLE_C * 1.61 - t * 1.7));
    slope += fifthDirection * (0.06 * cos(dot(warped, fifthDirection) * RIPPLE_C * 2.43 + t * 2.1));
    return slope * 0.16;
  }

  // Where the light that lands HERE entered the surface. Small-angle refraction
  // through a slope: the ray is deflected by (1 - eta) times the slope, and
  // travels uCausticDepth before it reaches the floor.
  //
  // The throw has to stay a fraction of a ripple wavelength. Push it past one
  // and neighbouring rays cross several crests before landing, the Jacobian
  // stops being locally meaningful, and the veins collapse into aliasing noise.
  vec2 refractedOrigin(vec2 floorPoint, float t) {
    vec2 slope = surfaceSlope(floorPoint, t);
    return floorPoint - slope * (1.0 - ${WATER_REFRACTION_RATIO.toFixed(6)}) * uCausticDepth;
  }
`;

const CAUSTICS_APPLICATION = /* glsl */ `
  #ifdef USE_OCEAN_CAUSTICS
  if (uCausticStrength > 0.0001) {
    vec2 floorPoint = vCausticWorldPosition.xz;
    vec2 origin = refractedOrigin(floorPoint, uCausticTime);

    // The area ratio, straight from screen-space derivatives: how much floor a
    // patch of wavefront covers now against how much it covered at the surface.
    // Above 1 the rays converged and the floor is bright; below 1 they spread.
    vec2 dx = dFdx(origin);
    vec2 dy = dFdy(origin);
    float newArea = abs(dx.x * dy.y - dx.y * dy.x);
    vec2 fx = dFdx(floorPoint);
    vec2 fy = dFdy(floorPoint);
    float oldArea = abs(fx.x * fy.y - fx.y * fy.x);

    float convergence = oldArea / max(newArea, 1e-7);
    // Only convergence brightens; divergence is already the unlit floor, and
    // subtracting there would punch holes rather than dim gently.
    float caustic = max(0.0, convergence - 1.0);
    // Caustic veins are thin and very bright rather than broad and faint, which
    // is what the power does; the clamp stops a near-singular Jacobian at a
    // focus from blowing out to white.
    // Clamped at 1.8, not 4: at 4 a focus saturated every channel, so the
    // sediment's grain, the rock's shading and the plant's colour all vanished
    // under the same white ribbon. An effect that erases the surface it lands on
    // has stopped being light on a surface.
    //
    // Then normalised to 0..1, so the strength uniform means the same thing here
    // as it does in the prototype, whose own caustic term is bounded at 1 by
    // construction. Without the division both renderers agreed on the constant
    // and disagreed by a factor of six on what it multiplied.
    caustic = min(1.8, pow(caustic, 1.6)) / 1.8;

    // Only upward-facing surfaces catch it, which is both the physics — the
    // light is coming down — and the fix for a numerical trap. On a face seen
    // edge-on, oldArea and newArea are both near zero and their ratio is noise;
    // left alone, kelp blades and rock walls sparkle.
    caustic *= smoothstep(0.0, 0.35, vCausticUpness);

    // No extra factor. The 0.16 was another tone-mapping workaround: under a
    // disabled curve a caustic vein blew to white, so it was scaled down until it
    // stopped — which left the sand with almost no pattern on it at all.
    gl_FragColor.rgb += uCausticColor * caustic * uCausticStrength;
  }
  #endif
`;

/**
 * Attaches the caustics to a standard material.
 *
 * Uses onBeforeCompile rather than a custom material so the surface keeps
 * three's own lighting, fog and tone mapping — caustics ADD to a lit surface,
 * and a hand-written material would have to reimplement all of it to get there.
 *
 * CHAINS onto whatever was already installed rather than replacing it. The
 * seabed needs two injections (macro variation on the albedo, caustics on the
 * output) and `onBeforeCompile` is a single slot, so an assignment here would
 * silently drop the other one — a compile-time-invisible bug that shows up only
 * as a texture that suddenly tiles again.
 */
export function applyCaustics(material: MeshStandardMaterial, uniforms: CausticsUniforms): void {
  // The node path takes the injection and returns. There is no `defines` to set
  // — a node graph has no preprocessor, and the gate the define provides is
  // simply whether this function was called on this material.
  if (uniforms.nodePatch && addNodeMaterialChunkPatch(material, uniforms.nodePatch())) {
    material.needsUpdate = true;
    return;
  }

  material.defines = { ...(material.defines ?? {}), USE_OCEAN_CAUSTICS: "" };
  const previous = material.onBeforeCompile;
  applyClassicShaderPatch(material, "oceanCaustics", (shader, renderer) => {
    previous?.(shader as never, renderer as never);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = requireShaderChunks(shader.vertexShader, "oceanCaustics vertex", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.worldPositionVertex
    ])
      .replace(
        SHADER_CHUNK_MARKERS.common,
        "#include <common>\nvarying vec3 vCausticWorldPosition;\nvarying float vCausticUpness;"
      )
      // Instancing has to be applied by hand here. three's own <worldpos_vertex>
      // does it, but only inside an `#if defined(USE_ENVMAP) || ...` — so its
      // worldPosition may not exist at all, and reading it would compile on the
      // shadow-casting floor and fail on a material without shadows. Computing
      // it fresh also fixes the failure that matters: without instanceMatrix
      // every rock and every kelp strand would sample the caustic pattern at
      // the mesh origin, so the entire scatter would light up in unison.
      .replace(
        SHADER_CHUNK_MARKERS.worldPositionVertex,
        `#include <worldpos_vertex>
  vec4 oceanCausticPosition = vec4(transformed, 1.0);
  mat3 oceanCausticRotation = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    oceanCausticPosition = instanceMatrix * oceanCausticPosition;
    oceanCausticRotation = oceanCausticRotation * mat3(instanceMatrix);
  #endif
  vCausticWorldPosition = (modelMatrix * oceanCausticPosition).xyz;
  vCausticUpness = normalize(oceanCausticRotation * objectNormal).y;`
      );
    shader.fragmentShader = requireShaderChunks(shader.fragmentShader, "oceanCaustics fragment", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.toneMappingFragment
    ])
      .replace(
        SHADER_CHUNK_MARKERS.common, "#include <common>\n" + CAUSTICS_CHUNK)
      // After tone mapping would wash them out; before it, a focus rolls off
      // through the same curve as every other highlight in the frame.
      .replace(
        SHADER_CHUNK_MARKERS.toneMappingFragment, CAUSTICS_APPLICATION + "\n#include <tonemapping_fragment>");
  });
  material.needsUpdate = true;
}
