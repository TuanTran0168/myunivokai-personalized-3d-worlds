import { Vector3 } from "three";
import type { Node } from "three/webgpu";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * One sun, two media, and one sky function.
 *
 * The ocean family has no HDRI and never will, so the sky above the water — when
 * a world is shallow enough to have one in frame — has to be computed. This is
 * Preetham's analytic daylight model, the one three.js ships as
 * `examples/jsm/objects/Sky.js`, restructured so it can be CALLED rather than
 * only used as a dome.
 *
 * The restructuring is the point. Sky.js computes its per-view constants in a
 * VERTEX shader, which makes the model unusable from any other material. They
 * depend only on turbidity, rayleigh, the Mie coefficient and the sun direction,
 * so they belong on the CPU — and then the same function serves three callers
 * that must never disagree with each other:
 *
 *   1. the sky dome above the water;
 *   2. the reflection in the surface (without the solar disc: a mirrored
 *      19000x disc through a wave normal is a field of white pixels, not a
 *      glitter path);
 *   3. the view up through Snell's window from below, with the refraction
 *      inverted per pixel.
 *
 * Turbidity is the setting that matters, and the value three.js's own ocean
 * example ships is wrong for this family: `turbidity: 10` is a hazy coastal sky
 * that measures at saturation 0.05 — a white rectangle — and water can only ever
 * be as blue as the sky it mirrors. 3 is the clear blue sky the ocean family
 * wants.
 */

export const WATER_REFRACTIVE_INDEX = 1.333;

/** Critical angle for total internal reflection, radians from vertical. */
export const SNELL_CRITICAL_ANGLE = Math.asin(1 / WATER_REFRACTIVE_INDEX);

export type SkyModelSettings = {
  /** Aerosol load. 2–4 is a clear blue sky; 10 is coastal haze. */
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
};

export const CLEAR_MARITIME_SKY: SkyModelSettings = {
  turbidity: 3,
  rayleigh: 3,
  mieCoefficient: 0.0035,
  mieDirectionalG: 0.8,
};

const TOTAL_RAYLEIGH: readonly [number, number, number] = [
  5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5,
];
const MIE_CONST: readonly [number, number, number] = [
  1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14,
];
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const SUN_INTENSITY_AT_ZENITH = 1000;

export type SkyCoefficients = {
  betaR: [number, number, number];
  betaM: [number, number, number];
  sunE: number;
  sunfade: number;
  mieDirectionalG: number;
};

/**
 * The per-view constants Sky.js computes in its vertex shader.
 *
 * `sunfade` evaluates to 1 for a unit sun vector, exactly as it does in the
 * three.js example — the reddening of a low sun comes from the optical path
 * length in the fragment stage, not from here.
 */
export function skyCoefficients(
  sunElevationRadians: number,
  settings: SkyModelSettings = CLEAR_MARITIME_SKY,
): SkyCoefficients {
  const sunUp = Math.sin(sunElevationRadians);
  const zenithCos = Math.min(1, Math.max(-1, sunUp));
  const sunE =
    SUN_INTENSITY_AT_ZENITH *
    Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(zenithCos)) / STEEPNESS)));
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sunUp / 450000)));
  const rayleighCoefficient = settings.rayleigh - (1 - sunfade);
  const c = 0.2 * settings.turbidity * 10e-18;
  const mie = 0.434 * c * settings.mieCoefficient;
  return {
    betaR: [
      TOTAL_RAYLEIGH[0] * rayleighCoefficient,
      TOTAL_RAYLEIGH[1] * rayleighCoefficient,
      TOTAL_RAYLEIGH[2] * rayleighCoefficient,
    ],
    betaM: [MIE_CONST[0] * mie, MIE_CONST[1] * mie, MIE_CONST[2] * mie],
    sunE,
    sunfade,
    mieDirectionalG: settings.mieDirectionalG,
  };
}

/**
 * The same sun, seen from underneath.
 *
 * Refraction bends it toward the zenith by Snell's law, so a sun 30 degrees above
 * the horizon appears at about 50 degrees when you look up at it through the
 * surface. There is no sun position that puts daylight OUTSIDE the 48.6-degree
 * cone, which is why the cone exists — and the underwater layers must use this
 * direction or the god rays and the hot spot inside Snell's window disagree with
 * the sky that is making them.
 */
export function refractedSunElevationRadians(sunElevationRadians: number): number {
  const horizontal = Math.cos(Math.max(0, sunElevationRadians));
  const sinRefracted = Math.min(1, horizontal / WATER_REFRACTIVE_INDEX);
  return Math.acos(Math.min(1, Math.max(-1, sinRefracted)));
}

/**
 * Where the sea is blue.
 *
 * Water mirrors the sky it faces; the sky opposite the sun is the deep blue one,
 * and the sky AT the horizon is white by optical path length no matter what.
 * Measured in the prototype: facing the sun gives an above-water frame at
 * saturation 0.12, facing 118 degrees away gives 0.17 overall and 0.31 in the
 * near field, with the same shaders and the same exposure. This is why every
 * guide to photographing the sea says to keep the sun behind your shoulder, and
 * it belongs in a camera default rather than in a shader.
 */
export const BLUE_SEA_YAW_OFFSET_RADIANS = (118 * Math.PI) / 180;

/**
 * Preetham's model as a callable GLSL function, plus the uniforms it needs.
 *
 * Ends with no tone mapping of its own on purpose: whoever includes this owns
 * `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`. A
 * custom ShaderMaterial that omits those gets neither exposure nor an sRGB
 * conversion, so everything above 1.0 clips flat to white — which is what glare
 * in this renderer has actually been every time it has been reported.
 */
/**
 * THE SKY MODEL'S CONSTANTS, DECLARED ONCE SO BOTH SHADER LANGUAGES READ THEM.
 *
 * These lived inside the GLSL string as `const float` declarations and as bare
 * literals. They were lifted out without changing a byte of the shader — the
 * extraction was verified by comparing the rebuilt string against the committed
 * one character for character — because §26's port needs a TSL twin of this
 * function, and two copies of Preetham's fit is two copies that drift.
 *
 * `oceanSky.test.ts` keeps that honest from here on: it scans the GLSL for any
 * numeric literal these constants cannot produce.
 *
 * Everything here except the last group comes from three.js's `Sky.js`, which
 * comes from Preetham et al. Changing one is changing the atmosphere.
 */
const SKY_PI = 3.141592653589793;

/** Optical depth of each medium at the zenith, in metres. */
const RAYLEIGH_ZENITH_LENGTH = 8.4e3;
const MIE_ZENITH_LENGTH = 1.25e3;

/** cos of the sun's angular radius, and the width of its edge. */
const SUN_ANGULAR_DIAMETER_COS = 0.9999566769464485;
const SUN_DISC_EDGE_SOFTNESS = 0.00002;
const SUN_DISC_INTENSITY = 19000;

/** Phase-function normalisation: 3/(16π) and 1/(4π). */
const THREE_OVER_SIXTEEN_PI = 0.05968310365946075;
const ONE_OVER_FOUR_PI = 0.07957747154594767;

/**
 * The optical-path fit, and the reason a low sun is red.
 *
 * `1 / (cos(zenith) + 0.15 * (93.885 - zenithDegrees)^-1.253)` is Preetham's
 * approximation of the air mass. The path grows without bound toward the
 * horizon, blue is scattered out of it, and no amount of tuning elsewhere
 * removes that — it can only be composed around.
 */
const AIR_MASS_COEFFICIENT = 0.15;
const AIR_MASS_HORIZON_DEGREES = 93.885;
const AIR_MASS_EXPONENT = -1.253;
const DEGREES_PER_HALF_TURN = 180;

/** The Rayleigh phase reads a cosine remapped from -1..1 into 0..1. */
const COSINE_REMAP_SCALE = 0.5;
const COSINE_REMAP_OFFSET = 0.5;

/** Exponents in the in-scattering composition, verbatim from Sky.js. */
const IN_SCATTER_POWER = 1.5;
const IN_SCATTER_SUNSET_POWER = 0.5;
const HORIZON_FALLOFF_POWER = 5;

/** The ambient floor and the final scale, before the model's own gamma. */
const AMBIENT_EXTINCTION_BASE = 0.1;
const SKY_EXPOSURE = 0.04;
const SKY_FLOOR_GREEN = 0.0003;
const SKY_FLOOR_BLUE = 0.00075;
const SKY_GAMMA_BASE = 1.2;
const SKY_GAMMA_SUNFADE = 1.2;

/** Guards a zero-length horizontal direction at the exact zenith. */
const FLAT_DIRECTION_EPSILON = 1e-5;

export const SKY_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uSkySunDirection;
  uniform vec3 uBetaR;
  uniform vec3 uBetaM;
  uniform float uSunE;
  uniform float uSunfade;
  uniform float uMieG;
`;

export const PREETHAM_SKY_GLSL = /* glsl */ `
  const float SKY_PI = ${SKY_PI};
  const float rayleighZenithLength = ${RAYLEIGH_ZENITH_LENGTH.toExponential(1).replace("e+", "E")};
  const float mieZenithLength = ${MIE_ZENITH_LENGTH.toExponential(2).replace("e+", "E")};
  const float sunAngularDiameterCos = ${SUN_ANGULAR_DIAMETER_COS};
  const float THREE_OVER_SIXTEENPI = ${THREE_OVER_SIXTEEN_PI};
  const float ONE_OVER_FOURPI = ${ONE_OVER_FOUR_PI};

  float rayleighPhase(float cosTheta) {
    return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0));
  }

  float hgPhase(float cosTheta, float g) {
    float g2 = pow(g, 2.0);
    float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, ${IN_SCATTER_POWER});
    return ONE_OVER_FOURPI * ((1.0 - g2) * inverse);
  }

  vec3 preethamSky(vec3 direction, bool withDisc) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    // Optical path length through the atmosphere, cut off at the horizon to
    // avoid the singularity. This single term is why a low sun is red and why
    // the horizon is white: the path grows without bound and blue is scattered
    // out of it. It cannot be tuned away, only composed around.
    float zenithAngle = acos(max(0.0, dot(up, direction)));
    float inverse = 1.0 / (cos(zenithAngle) +
      ${AIR_MASS_COEFFICIENT} * pow(${AIR_MASS_HORIZON_DEGREES} - ((zenithAngle * ${DEGREES_PER_HALF_TURN}.0) / SKY_PI), ${AIR_MASS_EXPONENT}));
    float sR = rayleighZenithLength * inverse;
    float sM = mieZenithLength * inverse;

    vec3 Fex = exp(-(uBetaR * sR + uBetaM * sM));

    float cosTheta = dot(direction, uSkySunDirection);
    vec3 betaRTheta = uBetaR * rayleighPhase(cosTheta * ${COSINE_REMAP_SCALE} + ${COSINE_REMAP_OFFSET});
    vec3 betaMTheta = uBetaM * hgPhase(cosTheta, uMieG);

    vec3 Lin = pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * (1.0 - Fex), vec3(${IN_SCATTER_POWER}));
    Lin *= mix(vec3(1.0),
      pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * Fex, vec3(${IN_SCATTER_SUNSET_POWER})),
      clamp(pow(1.0 - dot(up, uSkySunDirection), ${HORIZON_FALLOFF_POWER}.0), 0.0, 1.0));

    vec3 L0 = vec3(${AMBIENT_EXTINCTION_BASE}) * Fex;
    if (withDisc) {
      float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + ${SUN_DISC_EDGE_SOFTNESS}, cosTheta);
      L0 += (uSunE * ${SUN_DISC_INTENSITY}.0 * Fex) * sundisk;
    }

    vec3 texColor = (Lin + L0) * ${SKY_EXPOSURE} + vec3(0.0, ${SKY_FLOOR_GREEN}, ${SKY_FLOOR_BLUE});
    return pow(texColor, vec3(1.0 / (${SKY_GAMMA_BASE} + ${SKY_GAMMA_SUNFADE} * uSunfade)));
  }

  // Snell's window, done properly: un-refract the view direction and ask the
  // atmosphere what is actually there. sin(air) = 1.333 * sin(water) inverts
  // Snell, so the dark zenith lands at the centre of the cone and the entire
  // compressed horizon lands on its rim — which is the right way round, and the
  // difference between the iconic image and a lamp.
  vec3 skyThroughSnellsWindow(vec3 viewDirection, float sinTheta) {
    float sinAir = min(1.0, sinTheta * ${WATER_REFRACTIVE_INDEX});
    float cosAir = sqrt(max(0.0, 1.0 - sinAir * sinAir));
    vec3 flatDirection = normalize(vec3(viewDirection.x, 0.0, viewDirection.z) + vec3(${FLAT_DIRECTION_EPSILON.toExponential()}));
    return preethamSky(flatDirection * sinAir + vec3(0.0, 1.0, 0.0) * cosAir, true);
  }
`;

/**
 * Gerstner surface with an analytic normal and the folding Jacobian, shared by
 * every material that has to agree about where the water is.
 *
 * Both faces of the surface must call this. Before the prototype shared it, the
 * sea seen from above and the ceiling seen from below ran different wave
 * functions: two unrelated shapes for one sheet of water.
 */
export const WAVE_UNIFORMS_GLSL = (maxComponents: number) => /* glsl */ `
  uniform vec2 uWaveDir[${maxComponents}];
  // x: amplitude (m), y: wavenumber (rad/m), z: angular frequency (rad/s), w: phase
  uniform vec4 uWaveTerm[${maxComponents}];
  uniform int uWaveCount;
  uniform float uChoppiness;
  uniform float uWaveTime;
`;

export const GERSTNER_SURFACE_GLSL = (maxComponents: number) => /* glsl */ `
  void oceanSurface(vec2 p, out vec3 offset, out vec3 normal, out float jacobian) {
    offset = vec3(0.0);
    vec3 n = vec3(0.0, 1.0, 0.0);
    float jxx = 0.0;
    float jzz = 0.0;
    float jxz = 0.0;
    for (int i = 0; i < ${maxComponents}; i++) {
      if (i >= uWaveCount) break;
      vec2 d = uWaveDir[i];
      float amplitude = uWaveTerm[i].x;
      float k = uWaveTerm[i].y;
      float omega = uWaveTerm[i].z;
      float theta = k * dot(d, p) - omega * uWaveTime + uWaveTerm[i].w;
      float c = cos(theta);
      float s = sin(theta);
      // The horizontal half of the particle's circular orbit. It is the only
      // reason a rendered sea has the asymmetric profile a real one has: sines
      // give symmetric humps at any amplitude.
      float steep = uChoppiness * amplitude;
      offset.x -= d.x * steep * s;
      offset.z -= d.y * steep * s;
      offset.y += amplitude * c;
      // GPU Gems 1, chapter 1, equation 12. Finite differences would need three
      // extra evaluations of the whole sum per vertex and would still lag.
      float ka = k * amplitude;
      n.x -= d.x * ka * c;
      n.z -= d.y * ka * c;
      n.y -= uChoppiness * ka * s;
      jxx -= uChoppiness * ka * d.x * d.x * c;
      jzz -= uChoppiness * ka * d.y * d.y * c;
      jxz -= uChoppiness * ka * d.x * d.y * c;
    }
    normal = normalize(n);
    // Collapses exactly where the surface is overtaking itself, and overtaking
    // itself is what breaking IS. This is the foam mask.
    jacobian = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
  }
`;

/* ========================================================================
   THE SAME SKY, AS A NODE GRAPH
   ======================================================================== */

/**
 * The six values the sky model reads per view, as whatever node the calling
 * material built them from.
 *
 * Passed in rather than created here because three materials share this
 * function and each owns its own uniforms — the backdrop, the surface's
 * reflection and the view up through Snell's window must never disagree about
 * where the sun is, and they cannot disagree if they are handed the same nodes.
 */
export type SkyUniformNodes = {
  sunDirection: Node<"vec3">;
  betaRayleigh: Node<"vec3">;
  betaMie: Node<"vec3">;
  sunIntensity: Node<"float">;
  sunFade: Node<"float">;
  mieDirectionalG: Node<"float">;
};

/**
 * The six sky uniforms as a classic `IUniform` record, for every material that
 * inlines `SKY_UNIFORMS_GLSL`.
 *
 * **THE DECLARATION AND THE BINDING ARE WRITTEN ONCE BECAUSE A MISMATCH DOES NOT
 * FAIL.** A uniform declared in the GLSL and never bound reads ZERO, and a sky
 * with a zero sun direction is a flat grey dome rather than an error — so a name
 * drifting between `SKY_UNIFORMS_GLSL` and the object that fills it produces a
 * plausible wrong frame and no message at all. `oceanSky.test.ts` asserts the
 * two agree, which is only possible because both live here.
 *
 * Three materials SHARE one record by spreading it, so the sun cannot end up in
 * two places at once.
 */
export function skyUniformValues(
  sunDirection: Vector3,
  coefficients: SkyCoefficients
): Record<string, { value: unknown }> {
  return {
    uSkySunDirection: { value: sunDirection.clone() },
    uBetaR: { value: new Vector3(...coefficients.betaR) },
    uBetaM: { value: new Vector3(...coefficients.betaM) },
    uSunE: { value: coefficients.sunE },
    uSunfade: { value: coefficients.sunfade },
    uMieG: { value: coefficients.mieDirectionalG }
  };
}

/**
 * The same six values as TSL uniform nodes, for the node path.
 *
 * Built once per rig and shared by every node material that calls the sky, the
 * way the record above is shared on the classic path. Nothing writes to them
 * after construction: the sun does not move within a world.
 */
export function skyUniformNodes(
  modules: NodeMaterialModules,
  sunDirection: Vector3,
  coefficients: SkyCoefficients
): SkyUniformNodes {
  const { uniform } = modules.tsl;
  return {
    sunDirection: uniform(sunDirection.clone()) as unknown as Node<"vec3">,
    betaRayleigh: uniform(new Vector3(...coefficients.betaR)) as unknown as Node<"vec3">,
    betaMie: uniform(new Vector3(...coefficients.betaM)) as unknown as Node<"vec3">,
    sunIntensity: uniform(coefficients.sunE) as unknown as Node<"float">,
    sunFade: uniform(coefficients.sunfade) as unknown as Node<"float">,
    mieDirectionalG: uniform(coefficients.mieDirectionalG) as unknown as Node<"float">
  };
}

/**
 * Preetham's analytic daylight model as a TSL graph, from the constants above.
 *
 * **`withDisc` IS A JAVASCRIPT BOOLEAN AND THAT IS THE PORT, NOT A
 * SIMPLIFICATION.** The GLSL takes a `bool` parameter and every call site passes
 * a literal, so the branch is resolved before the shader exists in both
 * languages — the difference is only that a node graph has no preprocessor and
 * builds the branch it was asked for instead of compiling both. The reflection
 * call passes false for a reason worth keeping: a mirrored 19000x solar disc
 * seen through a wave normal is a field of white pixels, not a glitter path.
 */
export function preethamSkyNode(
  modules: NodeMaterialModules,
  uniforms: SkyUniformNodes,
  direction: Node<"vec3">,
  withDisc: boolean
): Node<"vec3"> {
  const { acos, clamp, cos, dot, exp, float, max, mix, pow, smoothstep, vec3 } = modules.tsl;
  const { sunDirection, betaRayleigh, betaMie, sunIntensity, sunFade, mieDirectionalG } = uniforms;

  const up = vec3(0, 1, 0);

  // The air mass, and the reason a low sun is red — see AIR_MASS_COEFFICIENT.
  const zenithAngle = acos(max(float(0), dot(up, direction)));
  const airMass = float(1).div(
    cos(zenithAngle).add(
      float(AIR_MASS_COEFFICIENT).mul(
        pow(
          float(AIR_MASS_HORIZON_DEGREES).sub(zenithAngle.mul(DEGREES_PER_HALF_TURN).div(SKY_PI)),
          float(AIR_MASS_EXPONENT)
        )
      )
    )
  );

  const extinction = exp(
    betaRayleigh.mul(float(RAYLEIGH_ZENITH_LENGTH).mul(airMass))
      .add(betaMie.mul(float(MIE_ZENITH_LENGTH).mul(airMass)))
      .negate()
  );

  const cosTheta = dot(direction, sunDirection);

  const rayleighPhase = float(THREE_OVER_SIXTEEN_PI).mul(
    float(1).add(pow(cosTheta.mul(COSINE_REMAP_SCALE).add(COSINE_REMAP_OFFSET), float(2)))
  );
  const gSquared = pow(mieDirectionalG, float(2));
  const henyeyGreensteinPhase = float(ONE_OVER_FOUR_PI).mul(
    float(1)
      .sub(gSquared)
      .div(pow(float(1).sub(mieDirectionalG.mul(2).mul(cosTheta)).add(gSquared), float(IN_SCATTER_POWER)))
  );

  const betaRayleighTheta = betaRayleigh.mul(rayleighPhase);
  const betaMieTheta = betaMie.mul(henyeyGreensteinPhase);
  const scatterRatio = betaRayleighTheta.add(betaMieTheta).div(betaRayleigh.add(betaMie));

  const inScatter = pow(
    sunIntensity.mul(scatterRatio).mul(float(1).sub(extinction)),
    vec3(IN_SCATTER_POWER)
  ).mul(
    mix(
      vec3(1, 1, 1),
      pow(sunIntensity.mul(scatterRatio).mul(extinction), vec3(IN_SCATTER_SUNSET_POWER)),
      clamp(pow(float(1).sub(dot(up, sunDirection)), float(HORIZON_FALLOFF_POWER)), float(0), float(1))
    )
  );

  let directLight = vec3(AMBIENT_EXTINCTION_BASE, AMBIENT_EXTINCTION_BASE, AMBIENT_EXTINCTION_BASE).mul(extinction);
  if (withDisc) {
    const sunDisc = smoothstep(
      float(SUN_ANGULAR_DIAMETER_COS),
      float(SUN_ANGULAR_DIAMETER_COS + SUN_DISC_EDGE_SOFTNESS),
      cosTheta
    );
    directLight = directLight.add(sunIntensity.mul(SUN_DISC_INTENSITY).mul(extinction).mul(sunDisc));
  }

  const exposed = inScatter
    .add(directLight)
    .mul(SKY_EXPOSURE)
    .add(vec3(0, SKY_FLOOR_GREEN, SKY_FLOOR_BLUE));

  return pow(
    exposed,
    vec3(1, 1, 1).div(float(SKY_GAMMA_BASE).add(sunFade.mul(SKY_GAMMA_SUNFADE)))
  ) as unknown as Node<"vec3">;
}

/**
 * The view up through Snell's window, as a node graph.
 *
 * Un-refracts the view direction and asks the atmosphere what is actually
 * there: `sin(air) = 1.333 * sin(water)` inverts Snell, so the dark zenith lands
 * at the centre of the cone and the compressed horizon lands on its rim. That is
 * the right way round, and the difference between the iconic image and a lamp.
 */
export function skyThroughSnellsWindowNode(
  modules: NodeMaterialModules,
  uniforms: SkyUniformNodes,
  viewDirection: Node<"vec3">,
  sinTheta: Node<"float">
): Node<"vec3"> {
  const { float, max, min, normalize, sqrt, vec3 } = modules.tsl;

  const sinAir = min(float(1), sinTheta.mul(WATER_REFRACTIVE_INDEX));
  const cosAir = sqrt(max(float(0), float(1).sub(sinAir.mul(sinAir))));
  const flatDirection = normalize(
    vec3(viewDirection.x, 0, viewDirection.z).add(
      vec3(FLAT_DIRECTION_EPSILON, FLAT_DIRECTION_EPSILON, FLAT_DIRECTION_EPSILON)
    )
  );
  return preethamSkyNode(
    modules,
    uniforms,
    flatDirection.mul(sinAir).add(vec3(0, 1, 0).mul(cosAir)) as unknown as Node<"vec3">,
    true
  );
}

/* ========================================================================
   THE SAME SURFACE, AS A NODE GRAPH
   ======================================================================== */

/**
 * The wave field's five uniforms, as whatever nodes the calling material built.
 *
 * `directions` and `terms` are ARRAY uniforms — one entry per wave component —
 * and they are the first of those in this migration. `uniformArray` takes the
 * same `Vector2[]` and `Vector4[]` the classic path puts in its `IUniform`, so
 * both paths read one set of numbers built once in `oceanRig`.
 */
export type WaveUniformNodes = {
  /**
   * Typed by the one method this function calls rather than as three's
   * `UniformArrayNode`: what the wave sum needs from an array uniform is
   * indexed access, and saying so keeps the contract readable and independent
   * of which node class `uniformArray` happens to return.
   */
  directions: { element: (index: Node<"int">) => Node<"vec2"> };
  terms: { element: (index: Node<"int">) => Node<"vec4"> };
  waveCount: Node<"int">;
  choppiness: Node<"float">;
  time: Node<"float">;
};

/** What one evaluation of the surface yields, and every caller needs all three. */
export type OceanSurfaceNodes = {
  offset: Node<"vec3">;
  normal: Node<"vec3">;
  /** Below zero the surface is overtaking itself, which is what breaking IS. */
  jacobian: Node<"float">;
};

/**
 * The Gerstner surface as a TSL graph, with the analytic normal and the folding
 * Jacobian — the node twin of `GERSTNER_SURFACE_GLSL`.
 *
 * **IT RETURNS A STRUCT BECAUSE THE LOOP MUST RUN ONCE.** The GLSL uses three
 * `out` parameters, which a node graph has no equivalent for; three separate
 * builders would each rebuild the whole sum, and this sum is the most expensive
 * thing in the ocean's vertex stage. A `struct` return keeps one loop and hands
 * back all three, which is what the `out` parameters were doing.
 *
 * **BOTH FACES OF THE WATER CALL THIS.** Before the shared version existed, the
 * sea seen from above and the ceiling seen from below ran different wave
 * functions — two unrelated shapes for one sheet of water — which is the whole
 * reason this lives here rather than in either material.
 */
export function oceanSurfaceNode(
  modules: NodeMaterialModules,
  uniforms: WaveUniformNodes,
  horizontalPosition: Node<"vec2">,
  maxComponents: number
): OceanSurfaceNodes {
  const { Break, Fn, If, Loop, cos, dot, float, normalize, sin, struct, vec3 } = modules.tsl;
  const { directions, terms, waveCount, choppiness, time } = uniforms;

  const OceanSurfaceStruct = struct({ offset: "vec3", normal: "vec3", jacobian: "float" }, "OceanSurface");

  const evaluate = Fn(([position]: [Node<"vec2">]) => {
    const offset = vec3(0, 0, 0).toVar();
    const surfaceNormal = vec3(0, 1, 0).toVar();
    const foldXX = float(0).toVar();
    const foldZZ = float(0).toVar();
    const foldXZ = float(0).toVar();

    Loop(maxComponents, ({ i }: { i: Node<"int"> }) => {
      If(i.greaterThanEqual(waveCount), () => {
        Break();
      });

      const direction = directions.element(i);
      const term = terms.element(i);
      const amplitude = term.x;
      const wavenumber = term.y;
      const angularFrequency = term.z;
      const theta = wavenumber
        .mul(dot(direction, position))
        .sub(angularFrequency.mul(time))
        .add(term.w);
      const cosine = cos(theta);
      const sine = sin(theta);

      // The horizontal half of the particle's circular orbit. It is the only
      // reason a rendered sea has the asymmetric profile a real one has: sines
      // give symmetric humps at any amplitude.
      const steepness = choppiness.mul(amplitude);
      offset.x.subAssign(direction.x.mul(steepness).mul(sine));
      offset.z.subAssign(direction.y.mul(steepness).mul(sine));
      offset.y.addAssign(amplitude.mul(cosine));

      // GPU Gems 1, chapter 1, equation 12. Finite differences would need three
      // extra evaluations of the whole sum per vertex and would still lag.
      const slope = wavenumber.mul(amplitude);
      surfaceNormal.x.subAssign(direction.x.mul(slope).mul(cosine));
      surfaceNormal.z.subAssign(direction.y.mul(slope).mul(cosine));
      surfaceNormal.y.subAssign(choppiness.mul(slope).mul(sine));
      foldXX.subAssign(choppiness.mul(slope).mul(direction.x).mul(direction.x).mul(cosine));
      foldZZ.subAssign(choppiness.mul(slope).mul(direction.y).mul(direction.y).mul(cosine));
      foldXZ.subAssign(choppiness.mul(slope).mul(direction.x).mul(direction.y).mul(cosine));
    });

    // Collapses exactly where the surface is overtaking itself, and overtaking
    // itself is what breaking IS. This is the foam mask.
    const jacobian = float(1)
      .add(foldXX)
      .mul(float(1).add(foldZZ))
      .sub(foldXZ.mul(foldXZ));

    return OceanSurfaceStruct(offset, normalize(surfaceNormal), jacobian);
  });

  const evaluated = evaluate(horizontalPosition);
  return {
    offset: evaluated.get("offset") as unknown as Node<"vec3">,
    normal: evaluated.get("normal") as unknown as Node<"vec3">,
    jacobian: evaluated.get("jacobian") as unknown as Node<"float">
  };
}
