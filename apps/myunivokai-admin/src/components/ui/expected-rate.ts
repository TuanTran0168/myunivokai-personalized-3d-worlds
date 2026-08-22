// Is an observed rate actually off, or is it just a small sample?
//
// This is the whole difference between the rarity screen being useful and being
// misleading. A 5% feature measured over 40 worlds is EXPECTED to come up twice;
// coming up four times is 10% — double the configured rate — and means nothing
// at all. Without this, the screen invites someone to go debugging a PRNG that
// is working perfectly.
//
// The maths is the normal approximation to the binomial, used in the direction
// it is actually valid: the true probability p is KNOWN (it is the configured
// one), and we are asking where the observed count should land. That is
// p ± z·√(p(1−p)/n), not a confidence interval around an estimate.
//
// It stops being a good approximation when either tail has too few expected
// events, so below that threshold this says so rather than drawing a band it
// cannot support.

/** 95%, the conventional two-sided band. */
const Z_SCORE_95 = 1.96;

/** The standard rule of thumb for when the normal approximation holds. */
const MINIMUM_EXPECTED_EVENTS = 5;

export type ExpectedRate =
  | { kind: "no-worlds" }
  /** Too few worlds for the configured rate to produce a stable observation. */
  | { kind: "too-few"; worldsNeeded: number }
  | {
      kind: "range";
      lowPercent: number;
      highPercent: number;
      /** False when the observation falls outside the band — the one case worth looking at. */
      withinExpectation: boolean;
    };

export function expectedRate(
  configuredPercent: number,
  eligibleWorlds: number,
  observedPercent: number
): ExpectedRate {
  if (eligibleWorlds <= 0) {
    return { kind: "no-worlds" };
  }
  const probability = configuredPercent / 100;
  const expectedHits = eligibleWorlds * probability;
  const expectedMisses = eligibleWorlds * (1 - probability);
  if (expectedHits < MINIMUM_EXPECTED_EVENTS || expectedMisses < MINIMUM_EXPECTED_EVENTS) {
    // How many worlds it would take for the rarer of the two outcomes to reach
    // the threshold. Reported so the screen can say "come back at 100 worlds"
    // instead of "unknown", which reads as a fault.
    const rarerSide = Math.min(probability, 1 - probability);
    return { kind: "too-few", worldsNeeded: Math.ceil(MINIMUM_EXPECTED_EVENTS / rarerSide) };
  }
  const standardError = Math.sqrt((probability * (1 - probability)) / eligibleWorlds);
  const marginPercent = Z_SCORE_95 * standardError * 100;
  const lowPercent = Math.max(0, roundToTwo(configuredPercent - marginPercent));
  const highPercent = Math.min(100, roundToTwo(configuredPercent + marginPercent));
  return {
    kind: "range",
    lowPercent,
    highPercent,
    withinExpectation: observedPercent >= lowPercent && observedPercent <= highPercent
  };
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
