"use client";

import { cn } from "@/lib/utils";
import { expectedRate } from "@/components/ui/expected-rate";

// One measured rate against the rate it was aimed at.
//
// A bullet-style bar rather than two bars side by side: the target is not a
// second measurement to compare heights with, it is the line the one
// measurement is judged against, so it is drawn as a line. Two bars invite the
// reader to compare their lengths to each other, which is a comparison that
// means nothing here.
//
// The shaded band behind the bar is where a correct lottery would land 95% of
// the time at this sample size. It is the difference between the screen saying
// "10% against a 5% target" — which reads as broken — and saying "10% is
// ordinary at forty worlds", which is the truth.
export function RateAgainstTarget({
  observedPercent,
  targetPercent,
  eligibleWorlds,
  scaleMaxPercent,
  className
}: {
  observedPercent: number;
  targetPercent: number;
  eligibleWorlds: number;
  /** Shared across the panel so bars stay comparable between features. */
  scaleMaxPercent: number;
  className?: string;
}) {
  const scale = Math.max(scaleMaxPercent, 1);
  const asWidth = (percent: number) => `${Math.min(100, (percent / scale) * 100)}%`;
  const band = expectedRate(targetPercent, eligibleWorlds, observedPercent);
  const isOutlier = band.kind === "range" && !band.withinExpectation;

  return (
    <div className={cn("relative h-6 w-full overflow-hidden rounded-md bg-accent/40", className)}>
      {band.kind === "range" ? (
        <div
          aria-hidden
          className="absolute inset-y-0 bg-foreground/[0.07]"
          style={{
            left: asWidth(band.lowPercent),
            width: asWidth(band.highPercent - band.lowPercent)
          }}
        />
      ) : null}

      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 rounded-md transition-[width] duration-500 ease-out",
          // Same colour StatCard's tone="warning" uses, for the same reason:
          // this is the one row worth looking at, and the app already spends
          // destructive on "look here" rather than on "this is broken".
          isOutlier ? "bg-destructive/55" : "bg-primary/60"
        )}
        style={{ width: asWidth(observedPercent) }}
      />

      {/* The target, drawn last so it stays visible over the bar it judges. */}
      <div
        aria-hidden
        className="absolute inset-y-0 w-px bg-foreground/70"
        style={{ left: asWidth(targetPercent) }}
      />
    </div>
  );
}
