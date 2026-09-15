/**
 * THE FOUR TONE CURVES THREE.JS OFFERS, TRANSCRIBED FROM ITS OWN SHADER.
 *
 * Every function here is a line-for-line port of
 * `three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`
 * at the version this repo pins. They are transcribed rather than imported
 * because a tone curve in three is GLSL that only exists inside a compiled
 * material — there is no JavaScript entry point to call with a colour.
 *
 * **WHAT THIS MEANS FOR THE NUMBERS BELOW: they are the curve, not the frame.**
 * A rendered pixel also carries the sun texture, the bloom pass, the grade, the
 * vignette and the film grain. This module answers one question only — what does
 * each curve do to a colour the sun's material hands the renderer — and that is
 * the question the owner's report is about, because the curve is the only thing
 * in that list which changed.
 *
 * GLSL `mat3(a, b, c)` builds COLUMNS, so every matrix here is transposed from
 * the source's literal argument order into row-major, and `applyMatrix` reads it
 * as rows. Getting this backwards produces a plausible-looking wrong answer,
 * which is why `measure.mjs` checks a known fixed point.
 */

const LINEAR_SRGB_TO_LINEAR_REC2020 = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0113],
  [0.0164, 0.088, 0.8956]
];

const LINEAR_REC2020_TO_LINEAR_SRGB = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187]
];

const AGX_INSET_MATRIX = [
  [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
  [0.137318972929847, 0.761241990602591, 0.101439036467562],
  [0.11189821299995, 0.0767994186031903, 0.811302368396859]
];

const AGX_OUTSET_MATRIX = [
  [1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
  [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
  [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405]
];

const AGX_MINIMUM_EXPOSURE_VALUE = -12.47393;
const AGX_MAXIMUM_EXPOSURE_VALUE = 4.026069;

const ACES_INPUT_MATRIX = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777]
];

const ACES_OUTPUT_MATRIX = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602]
];

/** three divides by this before the ACES fit, so ACES at exposure 1 is not unit gain. */
const ACES_EXPOSURE_DIVISOR = 0.6;

const NEUTRAL_START_COMPRESSION = 0.8 - 0.04;
const NEUTRAL_DESATURATION = 0.15;
const NEUTRAL_TOE_LIMIT = 0.08;
const NEUTRAL_TOE_CURVATURE = 6.25;
const NEUTRAL_TOE_OFFSET = 0.04;

const SRGB_LINEAR_SEGMENT_LIMIT = 0.04045;
const SRGB_LINEAR_SEGMENT_SLOPE = 12.92;
const SRGB_ENCODE_SEGMENT_LIMIT = 0.0031308;
const SRGB_CURVE_OFFSET = 0.055;
const SRGB_CURVE_SCALE = 1.055;
const SRGB_DECODE_EXPONENT = 2.4;
const EIGHT_BIT_MAXIMUM = 255;

function applyMatrix(matrix, color) {
  return matrix.map((row) => row[0] * color[0] + row[1] * color[1] + row[2] * color[2]);
}

/**
 * Every matrix above converts between two colour spaces that share a white
 * point, so each of its ROWS must sum to 1 — that is the same statement as
 * "white maps to white". Transposing one while transcribing it from GLSL breaks
 * that and nothing else complains: the curve still runs and still returns
 * plausible colours, slightly wrong.
 *
 * This is not a hypothetical. The first draft of this file had exactly two rows
 * of the two Rec.2020 matrices swapped, and the symptom was a pure white star
 * coming out of AgX as `211 206 218` — a violet-tinted grey — which reads as a
 * finding about the tone curve rather than as a typo. Exported so `measure.mjs`
 * asserts it before printing anything.
 */
export function colorSpaceMatrixRowSums() {
  return [
    { name: "LINEAR_SRGB_TO_LINEAR_REC2020", rowSums: LINEAR_SRGB_TO_LINEAR_REC2020.map(sumOfRow) },
    { name: "LINEAR_REC2020_TO_LINEAR_SRGB", rowSums: LINEAR_REC2020_TO_LINEAR_SRGB.map(sumOfRow) },
    { name: "AGX_INSET_MATRIX", rowSums: AGX_INSET_MATRIX.map(sumOfRow) },
    { name: "AGX_OUTSET_MATRIX", rowSums: AGX_OUTSET_MATRIX.map(sumOfRow) },
    { name: "ACES_INPUT_MATRIX", rowSums: ACES_INPUT_MATRIX.map(sumOfRow) },
    { name: "ACES_OUTPUT_MATRIX", rowSums: ACES_OUTPUT_MATRIX.map(sumOfRow) }
  ];
}

function sumOfRow(row) {
  return row[0] + row[1] + row[2];
}

function clampToDisplayRange(color) {
  return color.map((channel) => Math.min(1, Math.max(0, channel)));
}

function agxDefaultContrastApprox(value) {
  const squared = value * value;
  const fourth = squared * squared;
  return (
    15.5 * fourth * squared -
    40.14 * fourth * value +
    31.96 * fourth -
    6.868 * squared * value +
    0.4298 * squared +
    0.1191 * value -
    0.00232
  );
}

/**
 * What the app renders with today, for universe, forest and the fallback —
 * `DEFAULT_FAMILY_TONE_MAPPING` in `sceneToneMapping.ts`.
 */
export function agxToneMapping(color, exposure = 1) {
  let working = color.map((channel) => channel * exposure);
  working = applyMatrix(LINEAR_SRGB_TO_LINEAR_REC2020, working);
  working = applyMatrix(AGX_INSET_MATRIX, working);
  working = working.map((channel) => Math.log2(Math.max(channel, 1e-10)));
  working = working.map(
    (channel) =>
      (channel - AGX_MINIMUM_EXPOSURE_VALUE) / (AGX_MAXIMUM_EXPOSURE_VALUE - AGX_MINIMUM_EXPOSURE_VALUE)
  );
  working = clampToDisplayRange(working);
  working = working.map(agxDefaultContrastApprox);
  working = applyMatrix(AGX_OUTSET_MATRIX, working);
  working = working.map((channel) => Math.pow(Math.max(0, channel), 2.2));
  working = applyMatrix(LINEAR_REC2020_TO_LINEAR_SRGB, working);
  return clampToDisplayRange(working);
}

/** What the ocean family renders with, and what the other three could. */
export function acesFilmicToneMapping(color, exposure = 1) {
  let working = color.map((channel) => (channel * exposure) / ACES_EXPOSURE_DIVISOR);
  working = applyMatrix(ACES_INPUT_MATRIX, working);
  working = working.map((channel) => {
    const numerator = channel * (channel + 0.0245786) - 0.000090537;
    const denominator = channel * (0.983729 * channel + 0.432951) + 0.238081;
    return numerator / denominator;
  });
  working = applyMatrix(ACES_OUTPUT_MATRIX, working);
  return clampToDisplayRange(working);
}

/** Khronos PBR Neutral. Not currently used anywhere in the app. */
export function neutralToneMapping(color, exposure = 1) {
  const working = color.map((channel) => channel * exposure);
  const lowestChannel = Math.min(working[0], working[1], working[2]);
  const toeOffset =
    lowestChannel < NEUTRAL_TOE_LIMIT
      ? lowestChannel - NEUTRAL_TOE_CURVATURE * lowestChannel * lowestChannel
      : NEUTRAL_TOE_OFFSET;
  const offset = working.map((channel) => channel - toeOffset);

  const peak = Math.max(offset[0], offset[1], offset[2]);
  if (peak < NEUTRAL_START_COMPRESSION) {
    return clampToDisplayRange(offset);
  }

  const compressionHeadroom = 1 - NEUTRAL_START_COMPRESSION;
  const newPeak =
    1 - (compressionHeadroom * compressionHeadroom) / (peak + compressionHeadroom - NEUTRAL_START_COMPRESSION);
  const scaled = offset.map((channel) => (channel * newPeak) / peak);
  const desaturationMix = 1 - 1 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1);
  return clampToDisplayRange(
    scaled.map((channel) => channel * (1 - desaturationMix) + newPeak * desaturationMix)
  );
}

/**
 * What the app did BEFORE `3f09796` restored the curve — no curve at all, so
 * every linear value above 1 hit the display clamp flat.
 *
 * This is not a tone curve three offers. It is what `EffectComposer` leaves
 * behind when it sets `gl.toneMapping = NoToneMapping` on mount and the chain
 * contains no `<ToneMapping>` pass, which is the state universe, forest and the
 * fallback renderer shipped in for the app's whole life until 2026-09-10.
 */
export function hardClipNoToneMapping(color, exposure = 1) {
  return clampToDisplayRange(color.map((channel) => channel * exposure));
}

export const TONE_CURVES = [
  { key: "no-curve", label: "No curve (the old build)", apply: hardClipNoToneMapping },
  { key: "agx", label: "AgX (today)", apply: agxToneMapping },
  { key: "aces", label: "ACES Filmic", apply: acesFilmicToneMapping },
  { key: "neutral", label: "Khronos PBR Neutral", apply: neutralToneMapping }
];

export function srgbChannelToLinear(eightBitChannel) {
  const normalized = eightBitChannel / EIGHT_BIT_MAXIMUM;
  return normalized < SRGB_LINEAR_SEGMENT_LIMIT
    ? normalized / SRGB_LINEAR_SEGMENT_SLOPE
    : Math.pow((normalized + SRGB_CURVE_OFFSET) / SRGB_CURVE_SCALE, SRGB_DECODE_EXPONENT);
}

export function linearChannelToSrgb(linearChannel) {
  const encoded =
    linearChannel < SRGB_ENCODE_SEGMENT_LIMIT
      ? linearChannel * SRGB_LINEAR_SEGMENT_SLOPE
      : SRGB_CURVE_SCALE * Math.pow(linearChannel, 1 / SRGB_DECODE_EXPONENT) - SRGB_CURVE_OFFSET;
  return Math.round(Math.min(1, Math.max(0, encoded)) * EIGHT_BIT_MAXIMUM);
}

export function hexToLinearColor(hexColor) {
  return [1, 3, 5].map((offset) => srgbChannelToLinear(parseInt(hexColor.slice(offset, offset + 2), 16)));
}

export function linearColorToDisplayRgb(linearColor) {
  return linearColor.map(linearChannelToSrgb);
}

/** (highest − lowest) / highest, the same definition `e2e/sun-colour.spec.ts` uses. */
export function saturationOfDisplayRgb(displayRgb) {
  const highest = Math.max(...displayRgb);
  const lowest = Math.min(...displayRgb);
  return highest === 0 ? 0 : (highest - lowest) / highest;
}
