// The decision behind DeltaBadge, separated from the rendering so it can be
// tested. Everything here is a judgement about what a number MEANS, which is
// exactly the part that is wrong in most dashboards and the part a rendered
// component makes awkward to assert.

export interface DeltaLike {
  current: number;
  previous: number;
  changePercent: number;
  hasBaseline: boolean;
}

export type DeltaVerdict =
  /** The previous period holds nothing. There is no percentage to report. */
  | { kind: "no-baseline" }
  /** Identical to the previous period. Neither good nor bad. */
  | { kind: "flat"; label: string }
  | { kind: "good"; label: string; rising: boolean }
  | { kind: "bad"; label: string; rising: boolean };

export function describeDelta(
  delta: DeltaLike | undefined,
  // Required, never defaulted: more requests is growth and more errors is not,
  // and a default would silently colour half the cards backwards.
  higherIsBetter: boolean
): DeltaVerdict {
  if (!delta || !delta.hasBaseline) {
    return { kind: "no-baseline" };
  }
  if (delta.changePercent === 0) {
    return { kind: "flat", label: "0%" };
  }
  const rising = delta.changePercent > 0;
  const label = `${rising ? "+" : ""}${delta.changePercent}%`;
  return { kind: rising === higherIsBetter ? "good" : "bad", label, rising };
}
