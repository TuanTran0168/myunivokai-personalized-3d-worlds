/**
 * The sea surface from one number: the wind speed at 10 m.
 *
 * That is the number every marine forecast, every moored buoy and every paper on
 * this uses, so it is the number a scene config should carry. `windSpeedMps: 12`
 * means something to anyone; `swellAmplitudeMetres: 1.3` means nothing to
 * anybody, and cannot be checked against reality.
 *
 * Sources, all implemented literally:
 *   - Pierson & Moskowitz 1964, the one-parameter fully-developed spectrum:
 *       Hs   = 2.14e-2 * U^2
 *       wp   = 0.877 * g / U(19.5 m)
 *       S(w) = a g^2 w^-5 exp(-b (g / (U w))^4),  a = 8.1e-3, b = 0.74
 *   - Monahan & O'Muircheartaigh 1980, whitecap coverage:
 *       W = 3.84e-6 * U10^3.41
 *   - Deep-water dispersion: k = w^2 / g
 *
 * U(19.5) appears because the weather ships that produced the spectrum measured
 * at 19.5 m; the log wind profile puts it about 6% above U10.
 *
 * Written as pure functions with no three.js dependency so the same numbers can
 * be asserted in a unit test, produced by the backend, and uploaded to a shader.
 */

export const GRAVITY = 9.81;
const PM_ALPHA = 8.1e-3;
const PM_BETA = 0.74;
const U19_5_OVER_U10 = 1.06;

/** WMO Beaufort bands, upper bound in m/s at 10 m. */
const BEAUFORT_BANDS: readonly { below: number; force: number; name: string }[] = [
  { below: 0.5, force: 0, name: "Calm" },
  { below: 1.6, force: 1, name: "Light air" },
  { below: 3.4, force: 2, name: "Light breeze" },
  { below: 5.5, force: 3, name: "Gentle breeze" },
  { below: 8.0, force: 4, name: "Moderate breeze" },
  { below: 10.8, force: 5, name: "Fresh breeze" },
  { below: 13.9, force: 6, name: "Strong breeze" },
  { below: 17.2, force: 7, name: "Near gale" },
  { below: 20.8, force: 8, name: "Gale" },
  { below: 24.5, force: 9, name: "Strong gale" },
  { below: Number.POSITIVE_INFINITY, force: 10, name: "Storm" },
];

export function beaufort(windSpeedMps: number): { force: number; name: string } {
  const band = BEAUFORT_BANDS.find((entry) => windSpeedMps < entry.below);
  // The last band is unbounded, so this cannot miss; the fallback is for types.
  return band ?? { force: 10, name: "Storm" };
}

/** Significant wave height in metres, Pierson–Moskowitz. */
export function significantWaveHeightMetres(windSpeedMps: number): number {
  return 0.0214 * windSpeedMps * windSpeedMps;
}

export function peakAngularFrequency(windSpeedMps: number): number {
  const u19 = Math.max(0.35, windSpeedMps) * U19_5_OVER_U10;
  return (0.877 * GRAVITY) / u19;
}

export function peakWavelengthMetres(windSpeedMps: number): number {
  const omega = peakAngularFrequency(windSpeedMps);
  return (2 * Math.PI * GRAVITY) / (omega * omega);
}

/**
 * Fraction of the sea surface covered by whitecaps, 0..1.
 *
 * A real number for how much of the sea is white, in place of a foam slider:
 * about 1% at 10 m/s, about 4% at 15, a tenth of the surface in a gale.
 */
export function whitecapFraction(windSpeedMps: number): number {
  return 3.84e-6 * Math.pow(Math.max(0, windSpeedMps), 3.41);
}

/** Pierson–Moskowitz spectral density at an angular frequency. */
export function spectralDensity(windSpeedMps: number, omega: number): number {
  const u19 = Math.max(0.35, windSpeedMps) * U19_5_OVER_U10;
  return (
    ((PM_ALPHA * GRAVITY * GRAVITY) / Math.pow(omega, 5)) *
    Math.exp(-PM_BETA * Math.pow(GRAVITY / (u19 * omega), 4))
  );
}

export type WaveComponent = {
  /** Metres. */
  amplitude: number;
  /** rad/m. */
  wavenumber: number;
  /** rad/s. */
  angularFrequency: number;
  /** Radians, in the world XZ plane. */
  direction: number;
  /** Radians. Deterministic: it comes from the seeded generator, never Math.random. */
  phase: number;
};

export type SeaState = {
  windSpeedMps: number;
  windDirectionRadians: number;
  beaufortForce: number;
  beaufortName: string;
  significantHeightMetres: number;
  peakWavelengthMetres: number;
  whitecapFraction: number;
  components: WaveComponent[];
  /**
   * Gerstner steepness. Past `Q * sum(A k) = 1` the surface self-intersects and
   * renders as knots, so this is held at 0.72 of that limit: sharp crests, no
   * knots.
   */
  choppiness: number;
};

export const GERSTNER_STEEPNESS_SAFETY = 0.72;

/**
 * Realise the spectrum as a small number of Gerstner components.
 *
 * Amplitudes are `sqrt(2 S dw)` — the standard discrete realisation of a
 * continuous spectrum — then rescaled so `4 * sqrt(variance)` equals Hs exactly.
 * A spectrum sampled at twelve points does not carry its own variance faithfully,
 * but a significant wave height is a promise the renderer should keep.
 *
 * `random` must be a seeded generator: the same world has to make the same sea
 * on someone else's machine tomorrow.
 */
export function buildSeaState(options: {
  windSpeedMps: number;
  windDirectionRadians: number;
  random: () => number;
  componentCount?: number;
}): SeaState {
  const { windSpeedMps, windDirectionRadians, random } = options;
  const count = options.componentCount ?? 12;
  const peakOmega = peakAngularFrequency(windSpeedMps);
  const lowOmega = peakOmega * 0.55;
  const highOmega = peakOmega * 4;

  const components: WaveComponent[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const omega = lowOmega * Math.pow(highOmega / lowOmega, t);
    const width = omega * (Math.log(highOmega / lowOmega) / count);
    const density = spectralDensity(windSpeedMps, omega);
    components.push({
      amplitude: Math.sqrt(Math.max(0, 2 * density * width)),
      wavenumber: (omega * omega) / GRAVITY,
      angularFrequency: omega,
      // cos^2-ish directional spreading about the wind, narrowing with
      // frequency. Wind sea is not unidirectional, and a unidirectional sea
      // reads as corrugated fabric.
      direction: windDirectionRadians + (random() - 0.5) * 1.5 * (1 - 0.6 * t),
      phase: random() * Math.PI * 2,
    });
  }

  const variance = components.reduce(
    (sum, wave) => sum + wave.amplitude * wave.amplitude * 0.5,
    0,
  );
  const target = significantWaveHeightMetres(windSpeedMps);
  const scale = variance > 0 ? target / (4 * Math.sqrt(variance)) : 0;

  let steepness = 0;
  for (const wave of components) {
    wave.amplitude *= scale;
    steepness += wave.amplitude * wave.wavenumber;
  }

  const band = beaufort(windSpeedMps);
  return {
    windSpeedMps,
    windDirectionRadians,
    beaufortForce: band.force,
    beaufortName: band.name,
    significantHeightMetres: target,
    peakWavelengthMetres: peakWavelengthMetres(windSpeedMps),
    whitecapFraction: whitecapFraction(windSpeedMps),
    components,
    choppiness: steepness > 0 ? Math.min(1, GERSTNER_STEEPNESS_SAFETY / steepness) : 0,
  };
}

/**
 * Where the fold threshold has to sit for the foam to cover about `fraction` of
 * the surface.
 *
 * The Jacobian of the Gerstner displacement collapses exactly where the surface
 * is overtaking itself, and overtaking itself IS breaking — so foam belongs to
 * the Jacobian, not to crest height. This mapping from Monahan's coverage onto
 * the threshold is a fit rather than a derivation; the coverage going into it is
 * measured, which is the difference between a sea state and a slider.
 */
export function foamFoldThreshold(fraction: number): number {
  return 0.15 + 0.8 * Math.sqrt(Math.min(1, fraction / 0.04));
}
