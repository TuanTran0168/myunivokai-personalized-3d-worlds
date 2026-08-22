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
export const SKY_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uSkySunDirection;
  uniform vec3 uBetaR;
  uniform vec3 uBetaM;
  uniform float uSunE;
  uniform float uSunfade;
  uniform float uMieG;
`;

export const PREETHAM_SKY_GLSL = /* glsl */ `
  const float SKY_PI = 3.141592653589793;
  const float rayleighZenithLength = 8.4E3;
  const float mieZenithLength = 1.25E3;
  const float sunAngularDiameterCos = 0.9999566769464485;
  const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
  const float ONE_OVER_FOURPI = 0.07957747154594767;

  float rayleighPhase(float cosTheta) {
    return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0));
  }

  float hgPhase(float cosTheta, float g) {
    float g2 = pow(g, 2.0);
    float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
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
      0.15 * pow(93.885 - ((zenithAngle * 180.0) / SKY_PI), -1.253));
    float sR = rayleighZenithLength * inverse;
    float sM = mieZenithLength * inverse;

    vec3 Fex = exp(-(uBetaR * sR + uBetaM * sM));

    float cosTheta = dot(direction, uSkySunDirection);
    vec3 betaRTheta = uBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
    vec3 betaMTheta = uBetaM * hgPhase(cosTheta, uMieG);

    vec3 Lin = pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * (1.0 - Fex), vec3(1.5));
    Lin *= mix(vec3(1.0),
      pow(uSunE * ((betaRTheta + betaMTheta) / (uBetaR + uBetaM)) * Fex, vec3(0.5)),
      clamp(pow(1.0 - dot(up, uSkySunDirection), 5.0), 0.0, 1.0));

    vec3 L0 = vec3(0.1) * Fex;
    if (withDisc) {
      float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
      L0 += (uSunE * 19000.0 * Fex) * sundisk;
    }

    vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    return pow(texColor, vec3(1.0 / (1.2 + 1.2 * uSunfade)));
  }

  // Snell's window, done properly: un-refract the view direction and ask the
  // atmosphere what is actually there. sin(air) = 1.333 * sin(water) inverts
  // Snell, so the dark zenith lands at the centre of the cone and the entire
  // compressed horizon lands on its rim — which is the right way round, and the
  // difference between the iconic image and a lamp.
  vec3 skyThroughSnellsWindow(vec3 viewDirection, float sinTheta) {
    float sinAir = min(1.0, sinTheta * 1.333);
    float cosAir = sqrt(max(0.0, 1.0 - sinAir * sinAir));
    vec3 flatDirection = normalize(vec3(viewDirection.x, 0.0, viewDirection.z) + vec3(1e-5));
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
