import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DeltaBadge, type DeltaLike } from "@/components/ui/delta-badge";
import { cn } from "@/lib/utils";

// One headline number with its icon, a line of context and — where the backend
// computes one — how it moved against the equivalent period before it.
//
// Promoted here from features/analytics because both the analytics screens and
// the telemetry screens render it. It used to be imported across feature
// folders, which is the seam that turns "a card" into "the analytics card that
// telemetry happens to borrow" and eventually into two of them.
//
// `size` folds in what used to be a separate StatCardLite: the same card at a
// smaller type scale for figures worth showing that are not the headline. Two
// components differing only in font size is two places to fix a padding bug.
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  size = "default",
  delta,
  deltaHigherIsBetter,
  deltaPeriodLabel
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning";
  size?: "default" | "compact";
  /** Absent renders no badge at all — a card with nothing to compare says nothing. */
  delta?: DeltaLike;
  /** Required alongside `delta`: more requests is growth, more errors is not. */
  deltaHigherIsBetter?: boolean;
  deltaPeriodLabel?: string;
}) {
  const compact = size === "compact";
  return (
    <Card className="card-interactive">
      <CardContent className="pt-2">
        <div className={cn("flex gap-3", compact ? "items-center gap-2.5" : "items-start")}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg transition-colors",
              compact ? "size-7" : "size-8",
              tone === "warning" ? "bg-destructive/15" : "bg-primary/15"
            )}
          >
            <Icon className={cn("size-4", tone === "warning" ? "text-destructive" : "text-primary")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p
                className={cn(
                  "truncate font-heading font-semibold tabular-nums text-foreground",
                  compact ? "text-sm" : "text-xl"
                )}
              >
                {value}
              </p>
              {delta !== undefined && deltaHigherIsBetter !== undefined ? (
                <DeltaBadge
                  delta={delta}
                  higherIsBetter={deltaHigherIsBetter}
                  periodLabel={deltaPeriodLabel ?? "the previous period"}
                />
              ) : null}
            </div>
            {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
