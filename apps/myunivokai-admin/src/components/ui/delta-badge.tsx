import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { describeDelta, type DeltaLike } from "@/components/ui/delta";
import { cn } from "@/lib/utils";

export type { DeltaLike };

// The one place a period-over-period change is rendered, because there are
// exactly three ways this badge can lie and all three are easy to write by
// accident:
//
// 1. NO BASELINE IS NOT ZERO. A period whose predecessor holds no data has no
//    percentage. Both services already say so with `hasBaseline: false`, and
//    this prints "no baseline" instead of an arrow — "+100%" against nothing is
//    a trend that never happened.
// 2. UP IS NOT ALWAYS GOOD. More requests is growth; more errors and a higher
//    p95 are the opposite. `higherIsBetter` is required rather than defaulted
//    so that adding a card forces the question to be answered.
// 3. THE ABSOLUTE VALUES MATTER. +100% is two becoming four or twenty thousand
//    becoming forty thousand, so the title carries both.
//
// The decision itself lives in ./delta.ts and is unit-tested there. Colour and
// arrow direction are both unavailable to a screen reader and to anyone with a
// red/green deficiency, so the sign is always in the text as well.
export function DeltaBadge({
  delta,
  higherIsBetter,
  periodLabel,
  className
}: {
  delta: DeltaLike | undefined;
  higherIsBetter: boolean;
  /** What the comparison is against, e.g. "the previous 24 hours". */
  periodLabel: string;
  className?: string;
}) {
  const verdict = describeDelta(delta, higherIsBetter);

  if (verdict.kind === "no-baseline") {
    return (
      <span
        className={cn("text-xs text-muted-foreground", className)}
        title={`Nothing was recorded in ${periodLabel}, so there is no percentage to report.`}
      >
        no baseline
      </span>
    );
  }

  const Icon =
    verdict.kind === "flat" ? ArrowRight : verdict.rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors",
        verdict.kind === "flat" && "bg-muted text-muted-foreground",
        verdict.kind === "good" && "bg-success/15 text-success",
        verdict.kind === "bad" && "bg-destructive/15 text-destructive",
        className
      )}
      title={
        delta
          ? `${delta.current.toLocaleString()} now, ${delta.previous.toLocaleString()} in ${periodLabel}`
          : undefined
      }
    >
      <Icon className="size-3" aria-hidden />
      {verdict.label}
    </span>
  );
}
