/**
 * The ocean as an optical medium.
 *
 * Everything the renderer needs to know about water colour, how far you can see
 * through it and how much light is left at a depth comes from ONE input: which
 * kind of water it is. Jerlov (1976) classified the world's water by its
 * downwelling diffuse attenuation coefficient Kd, and ocean optics still uses
 * that scheme — I, IA, IB, II, III for open ocean and 1C–9C for coastal.
 *
 * This replaces a hand-authored palette with a derivation, and the reason to
 * care is in notes/fe/ocean-visual-direction-research.md §11j: a palette can
 * pair fifty metres of visibility with estuary-green water, and Kd cannot.
 *
 * Two facts are load-bearing and worth stating before the code:
 *
 *   - **Pure seawater is a floor, not a parameter.** No water can be clearer
 *     than about 0.30 / 0.065 / 0.016 per metre in red / green / blue, which is
 *     why red dies in the first few metres of even the clearest ocean.
 *   - **Turbidity is not just "more attenuation", it has a colour.** What makes
 *     water turbid — CDOM and phytoplankton — absorbs hardest at short
 *     wavelengths, so the added attenuation is blue-weighted. That is the whole
 *     reason coastal water is green while open ocean is blue, and at the turbid
 *     end this model produces brown on its own, because Kd(blue) overtakes
 *     Kd(red).
 */

/** Absorption of pure seawater in red / green / blue, per metre. A hard floor. */
export const PURE_SEAWATER_KD: readonly [number, number, number] = [0.3, 0.065, 0.016];

/**
 * Spectral shape of the attenuation a water type adds ON TOP of pure seawater,
 * relative to its blue value. Blue-weighted because that is how CDOM absorbs.
 */
export const TURBIDITY_SHAPE: readonly [number, number, number] = [0.5, 0.8, 1.0];

export type JerlovWaterType =
  | "I"
  | "IA"
  | "IB"
  | "II"
  | "III"
  | "1C"
  | "3C"
  | "5C"
  | "7C"
  | "9C";

export type JerlovWaterTypeInfo = {
  type: JerlovWaterType;
  /** Published Kd at 475 nm, m^-1. Mid-band, since the literature gives ranges. */
  kd475: number;
  /** What kind of place this water is, for a readout or a rarity catalogue. */
  description: string;
};

/**
 * Ordered clearest to most turbid, which is also the order a slider or a
 * rarity tier wants them in.
 */
export const JERLOV_WATER_TYPES: readonly JerlovWaterTypeInfo[] = [
  { type: "I", kd475: 0.025, description: "open ocean, clearest" },
  { type: "IA", kd475: 0.038, description: "open ocean" },
  { type: "IB", kd475: 0.05, description: "open ocean" },
  { type: "II", kd475: 0.085, description: "open ocean, productive" },
  { type: "III", kd475: 0.13, description: "open ocean, turbid" },
  { type: "1C", kd475: 0.2, description: "coastal, clear" },
  { type: "3C", kd475: 0.42, description: "coastal" },
  { type: "5C", kd475: 0.7, description: "coastal, turbid" },
  { type: "7C", kd475: 1.2, description: "estuarine" },
  { type: "9C", kd475: 2.0, description: "estuarine, most turbid" },
];

/** Open ocean away from a coast, which is what an unconfigured world should be. */
export const DEFAULT_WATER_TYPE: JerlovWaterType = "IB";

export type WaterAttenuation = {
  type: JerlovWaterType;
  description: string;
  /** Kd per channel, m^-1. */
  kd: [number, number, number];
};

export function waterTypeInfo(type: JerlovWaterType): JerlovWaterTypeInfo {
  const found = JERLOV_WATER_TYPES.find((entry) => entry.type === type);
  if (!found) {
    throw new Error(`Unknown Jerlov water type: ${type}`);
  }
  return found;
}

/**
 * Kd per RGB channel for a water type.
 *
 * The published tables are spectra rather than three numbers, so this is a
 * reconstruction from two individually sourced terms — the pure-water floor and
 * the type's own blue-weighted load — not a copied table. Stated plainly because
 * the difference matters if anyone ever compares it against a paper.
 */
export function waterAttenuation(type: JerlovWaterType = DEFAULT_WATER_TYPE): WaterAttenuation {
  const info = waterTypeInfo(type);
  const load = Math.max(0, info.kd475 - PURE_SEAWATER_KD[2]);
  return {
    type: info.type,
    description: info.description,
    kd: [
      PURE_SEAWATER_KD[0] + load * TURBIDITY_SHAPE[0],
      PURE_SEAWATER_KD[1] + load * TURBIDITY_SHAPE[1],
      PURE_SEAWATER_KD[2] + load * TURBIDITY_SHAPE[2],
    ],
  };
}

/**
 * Beer–Lambert transmission per channel after `metres` of water.
 *
 * This is the depth curve, and it is three lines rather than a table because
 * the table was only ever a curve fitted to one kind of water.
 */
export function transmissionAtDepth(
  attenuation: WaterAttenuation,
  metres: number,
): [number, number, number] {
  const depth = Math.max(0, metres);
  return [
    Math.exp(-attenuation.kd[0] * depth),
    Math.exp(-attenuation.kd[1] * depth),
    Math.exp(-attenuation.kd[2] * depth),
  ];
}

/**
 * Perceptual compression of the light that is left.
 *
 * Irradiance falls exponentially and perception does not: an eye that has lost
 * 90% of its light has not lost 90% of what it can see. This exponent is the
 * difference between water that reads as bright blue at seventeen metres and
 * water that reads as near-black there, and it is applied BEFORE anything
 * decides how bright to draw the frame.
 */
export const PERCEPTUAL_EXPONENT = 0.42;

export function perceptualBrightness(luminance: number): number {
  return Math.pow(Math.max(0, luminance), PERCEPTUAL_EXPONENT);
}

/** Rec. 709 luminance weights: how much light an EYE thinks is left. */
export function luminousTransmission(transmission: [number, number, number]): number {
  return 0.2126 * transmission[0] + 0.7152 * transmission[1] + 0.0722 * transmission[2];
}

/**
 * How far you can see horizontally, in metres.
 *
 * Contrast against a background falls by 1/e per attenuation length and the eye
 * gives up at roughly 2% contrast, which is about 4.6 lengths.
 *
 * **This does not depend on depth**, and the renderer's previous model had it
 * depending on how much light was left, which is wrong: at two thousand metres a
 * lamp reaches exactly as far as it does at twenty. What runs out with depth is
 * the sun, not the water's clarity. Getting that backwards is why an abyssal
 * world could not show its own seabed.
 */
export const CONTRAST_ATTENUATION_LENGTHS = 4.6;

export function sightingRangeMetres(attenuation: WaterAttenuation): number {
  const range = CONTRAST_ATTENUATION_LENGTHS / attenuation.kd[1];
  return Math.min(90, Math.max(6, range));
}

/**
 * Depth at which 1% of surface blue light remains — the number oceanographers
 * quote as the euphotic depth, and a good sanity check on the whole model:
 * open-ocean water should land near 100 m.
 */
export function onePercentBlueDepthMetres(attenuation: WaterAttenuation): number {
  return CONTRAST_ATTENUATION_LENGTHS / attenuation.kd[2];
}

/**
 * FogExp2 density that matches a sighting range.
 *
 * three.js's exponential-squared fog reaches about 98% at `1 / density` metres,
 * so the density is simply the reciprocal of the range. Kept as a named function
 * because every renderer that draws this water has to agree with every other one.
 */
export function fogDensityForRange(rangeMetres: number): number {
  return 1 / Math.max(1, rangeMetres);
}

export type WaterPalette = {
  /**
   * The water's own VALUE before the abyssal-gloom blend: 0.13 at the bottom,
   * about 0.79 at the surface.
   *
   * Published separately from `fog` because anything meant to read as brighter
   * than the water has to be measured against the water, and `max(fog)` stopped
   * being that number when the gloom blend moved after normalisation. Callers
   * using `max(fog)` as a stand-in silently lost up to two thirds of the value in
   * deep water — which dimmed Snell's window exactly where it is the only thing
   * in frame.
   */
  fogValue: number;
  /** Linear RGB in 0..1, hue from absorption and value from the curve below. */
  fog: [number, number, number];
  /** 0..1, how much light an eye has left at this depth. */
  luminance: number;
  /** The same, perceptually compressed: what every light intensity runs on. */
  brightness: number;
  sightingRangeMetres: number;
  fogDensity: number;
};

/**
 * The water's own colour at a depth.
 *
 * Absorption decides WHICH HUE survives — that part is sound and it is what
 * makes depth legible without anyone authoring a palette. It must not also
 * decide how bright the frame is: multiplying the colour by the surviving light
 * counts depth twice and produces a near-black at seventeen metres, where real
 * clear water photographs as a luminous blue. So the value comes from a curve
 * with a floor, and the floor is what stops an abyss being a black rectangle.
 * See §11c of the research note.
 */
/**
 * sRGB to linear, per IEC 61966-2-1.
 *
 * # Why this function exists rather than a table of numbers
 *
 * Every colour below was authored as a hex string — the form a designer picks a
 * colour in, and the form the prototype stores it in. `new Color("#2C93AC")`
 * converts sRGB to linear on the way in, so the prototype's shading maths runs on
 * linear values. This module stored the same colours as plain arrays and the
 * conversion was never applied to most of them, so `[0.17, 0.58, 0.67]` — the
 * sRGB FRACTIONS of #2C93AC — went into the same maths as if it were linear.
 *
 * The error is large and it is not uniform: red comes out about 6.8x too high,
 * green 2x, blue 1.6x. Since the palette renormalises by its own peak, the
 * brightness error mostly cancels and the HUE error does not — so the water came
 * out systematically paler and less saturated than the water it was copied from,
 * worst where the colour is darkest. Measured: the abyss rendered at saturation
 * 0.42 against the prototype's 0.60, and a mean of #41626e against #1a3543.
 *
 * `SKY_HAZE_LINEAR` was already converted, which is what made this findable: one
 * constant in the file obeyed the rule and the rest did not.
 */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** A hex colour as linear RGB — the same conversion `new Color(hex)` performs. */
export function linearFromHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((value >> 16) & 255) / 255),
    srgbToLinear(((value >> 8) & 255) / 255),
    srgbToLinear((value & 255) / 255),
  ];
}

/**
 * The colour clear water has of its own, before any depth is applied. Every
 * water body is a version of this, dimmed and shifted by its own Kd.
 */
export const CLEAR_WATER = linearFromHex("#2C93AC");
/** The blue-violet an unlit water column scatters back at you. */
export const ABYSS_GLOOM = linearFromHex("#0A2438");

export const FOG_VALUE_FLOOR = 0.13;
export const FOG_VALUE_RANGE = 0.66;

export function waterPalette(
  type: JerlovWaterType,
  viewerDepthMetres: number,
): WaterPalette {
  const attenuation = waterAttenuation(type);
  const transmission = transmissionAtDepth(attenuation, viewerDepthMetres);
  const luminance = luminousTransmission(transmission);

  // Hue: the surviving spectrum, tempered TOWARD THE WATER'S OWN COLOUR so a
  // single channel cannot own the frame. Tempering toward white instead is a
  // mistake that only shows up in deep water — as transmission goes to zero
  // every channel converges on the same value and the abyss renders grey. It
  // was caught by measuring the frame's saturation, not by looking at it.
  const tempered: [number, number, number] = [
    CLEAR_WATER[0] * (transmission[0] * 0.66 + 0.34),
    CLEAR_WATER[1] * (transmission[1] * 0.66 + 0.34),
    CLEAR_WATER[2] * (transmission[2] * 0.66 + 0.34),
  ];
  // Set the VALUE independently, and give it a floor. 0.13 at the bottom is a
  // dark navy you can still read; zero is a black rectangle.
  const brightness = perceptualBrightness(luminance);
  const value = FOG_VALUE_FLOOR + FOG_VALUE_RANGE * Math.pow(brightness, 0.8);
  const peak = Math.max(tempered[0], tempered[1], tempered[2], 1e-4);
  const scale = value / peak;
  const fog: [number, number, number] = [
    tempered[0] * scale,
    tempered[1] * scale,
    tempered[2] * scale,
  ];

  // Below the photic zone the hue swings to the blue-violet of scattered
  // bioluminescence, because that is the only light being made down there.
  //
  // AFTER the value normalisation, and that order is the whole point. Blending
  // toward the gloom before normalising and then renormalising to `value` throws
  // away the darkening the blend just performed — the gloom becomes a pure hue
  // shift and the trench comes back out at the same brightness as the twilight
  // zone above it. Measured, that mistake rendered the abyss at luma 0.33 against
  // the prototype's 0.19, which is what "the abyss is not dark" was.
  //
  // Driven by BRIGHTNESS against 0.16, not by raw luminance against 0.02. The
  // gloom is a statement about what an adapted eye sees, so it has to be measured
  // in the same perceptual units the eye works in; against raw luminance the
  // blend reached 83% at 142 m where it should have reached 59%.
  const gloomMix = Math.pow(1 - Math.min(1, brightness / 0.16), 1.5) * 0.85;
  for (let i = 0; i < 3; i += 1) {
    fog[i] += (ABYSS_GLOOM[i] - fog[i]) * gloomMix;
  }

  const range = sightingRangeMetres(attenuation);
  return {
    fog,
    fogValue: value,
    luminance,
    brightness,
    sightingRangeMetres: range,
    fogDensity: fogDensityForRange(range),
  };
}

/** The sun's colour at the surface, before the water takes anything out of it. */
export const SURFACE_SUN = linearFromHex("#FFF4DC");
/**
 * The floor under every key-light channel.
 *
 * Absorption drives the red channel to zero long before the others, and a key
 * light with a zero channel shades every object as if it were lit through a
 * filter. This is the residual blue-green an unlit column still scatters back
 * onto a surface, and it is what keeps the deep from shading monochrome.
 */
export const KEY_LIGHT_FLOOR = linearFromHex("#08222E");

/**
 * The key light's colour at a depth.
 *
 * Normalised BY ITS OWN PEAK before being scaled, which is the part that matters
 * and the part the rig previously left out. Without the division the key's
 * magnitude rides on whatever the surviving spectrum happens to sum to, so it
 * dims twice — once through `spectral` and again through the scale factor — and
 * the deep ends up with a key roughly a third of its intended strength. Pinning
 * the peak makes `0.22 + 0.78·brightness^0.7` mean exactly what it says: the
 * ratio between this depth's key and the surface's.
 *
 * That matters more than it sounds. The ratios between key, fill and ambient are
 * what a viewer reads as depth; absolute darkness carries nothing. A key that is
 * quietly too dark hands the whole near field to the dive lamp, which is why the
 * sponges were blowing out — the lamp was doing a job the key should have shared.
 */
export function keyLightColour(
  type: JerlovWaterType,
  viewerDepthMetres: number,
): [number, number, number] {
  const attenuation = waterAttenuation(type);
  const transmission = transmissionAtDepth(attenuation, viewerDepthMetres);
  const brightness = perceptualBrightness(luminousTransmission(transmission));
  // A fifth of the surface colour survives regardless: the key is direct sun,
  // and direct sun keeps its own hue further down than scattered light does.
  const tempered: [number, number, number] = [
    SURFACE_SUN[0] * (transmission[0] * 0.78 + 0.22),
    SURFACE_SUN[1] * (transmission[1] * 0.78 + 0.22),
    SURFACE_SUN[2] * (transmission[2] * 0.78 + 0.22),
  ];
  const peak = Math.max(tempered[0], tempered[1], tempered[2], 1e-4);
  const scale = (0.22 + 0.78 * Math.pow(brightness, 0.7)) / peak;
  return [
    Math.max(tempered[0] * scale, KEY_LIGHT_FLOOR[0]),
    Math.max(tempered[1] * scale, KEY_LIGHT_FLOOR[1]),
    Math.max(tempered[2] * scale, KEY_LIGHT_FLOOR[2]),
  ];
}

/**
 * Tone-map exposure for a depth: an adaptation model, not a brightness dial.
 *
 * A dark-adapted eye gains about five orders of magnitude in twenty minutes, and
 * every deep-sea image humanity owns was made either by such an eye or by a
 * camera carrying its own light. Mapping irradiance straight to display
 * luminance is photometry, not photography. This only ever LIFTS a frame that
 * has gone too dark to read, and is 1.02 near the surface, where it does nothing.
 *
 * Takes the PERCEPTUAL brightness, not raw luminance: adaptation is a property
 * of the eye, so it has to be driven by what the eye is getting.
 */
export function adaptationExposure(brightness: number): number {
  const shortfall = 1 - Math.min(1, brightness / 0.26);
  return 1.02 + Math.pow(shortfall, 1.6) * 0.62;
}

/**
 * The medium above the waterline.
 *
 * A negative depth is not a special case bolted on — it is the same rig with
 * the medium swapped, and swapping the medium is enough. Air extinguishes
 * visible light roughly a thousand times more slowly than water, so three
 * things change together and nothing else has to: visibility becomes
 * kilometres rather than tens of metres, distance reads as HAZE rather than as
 * absorption (haze adds light, absorption removes it), and nothing in frame is
 * dark, so the adaptation model has nothing to lift.
 *
 * The exposure is the one number here that is a photographic decision rather
 * than a physical constant, and it is the decision every photographer makes at
 * the coast: meter for the WATER and let the sun clip. Preetham returns
 * radiance in its own units — around 0.6 to 1.5 after its own gamma — and ACES
 * turns anything past 1.0 into white, so metering for the sky produces a white
 * rectangle with a sea-coloured strip at the bottom. three.js's own ocean
 * example runs at 0.5, but its water is a dark blue-green mirror of a dome;
 * this one reflects the sky analytically across the whole frame and is
 * brighter. It scales down further as the sun drops, because a low sun means a
 * long optical path and a much brighter aureole to meter against.
 */
// Derived rather than typed: the hand-converted [0.36, 0.52, 0.66] was close to
// correct, but "close" in a colour constant is how the rest of this file drifted.
export const SKY_HAZE_LINEAR = linearFromHex("#9BBBD2");

/** Sighting range in air at sea level in clear conditions, metres. */
export const AIR_SIGHTING_RANGE_METRES = 1200;

export function airPalette(): WaterPalette {
  return {
    fog: [...SKY_HAZE_LINEAR] as [number, number, number],
    // Air has no depth curve, so its value is simply the haze's own.
    fogValue: Math.max(...SKY_HAZE_LINEAR),
    luminance: 1,
    brightness: 1,
    sightingRangeMetres: AIR_SIGHTING_RANGE_METRES,
    // Not 1/range: in air the haze is thin enough that FogExp2 at the
    // reciprocal would erase the horizon entirely. Measured against a real
    // coastal photograph, where a headland eight kilometres out is still
    // legible.
    fogDensity: 0.00085,
  };
}

export function airExposure(sunElevationSine: number): number {
  return 0.26 * (0.62 + 0.38 * Math.min(1, Math.max(0, sunElevationSine) / 0.5));
}

/** True when the viewer is above the waterline rather than under it. */
export function isAboveWater(viewerDepthMetres: number): boolean {
  return viewerDepthMetres < 0;
}
