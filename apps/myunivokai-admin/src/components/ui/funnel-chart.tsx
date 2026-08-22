import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface FunnelStageLike {
  stage: string;
  label: string;
  count: number;
  percentOfEntry: number;
}

// A funnel drawn as hand-rolled bars rather than a charting library's funnel.
//
// Two reasons, and the second is the load-bearing one. Recharts has no funnel
// series, and the trapezoid shape every other library draws encodes the drop
// as AREA — which is unreadable at the small drops that matter here and
// actively misleading when a stage exceeds the entry count, as the telemetry
// funnel's does (one HTTP request can call several backends). Bar length is
// linear in the number, and a bar can be longer than the first one.
//
// Widths are scaled against the LARGEST stage so an over-100% stage still fits;
// the printed percentage is always against the ENTRY, which is the number the
// backends compute and the only one that reads end to end.
export function FunnelChart({
  title,
  description,
  stages,
  isLoading = false,
  emptyLabel = "Nothing entered this funnel in the selected window.",
  formatCount,
  colorFor
}: {
  title: string;
  description?: string;
  stages: FunnelStageLike[];
  isLoading?: boolean;
  emptyLabel?: string;
  formatCount: (value: number) => string;
  /** Per-stage colour, by index. Defaults to a single accent for every bar. */
  colorFor?: (index: number) => string;
}) {
  const widest = stages.reduce((largest, stage) => Math.max(largest, stage.count), 0);

  return (
    <SectionCard title={title} description={description}>
      {isLoading ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : stages.length === 0 || widest === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5">
          {stages.map((stage, index) => {
            const previous = index === 0 ? null : stages[index - 1];
            // The drop from the stage above, which is the number a funnel is
            // read for and the one nobody can compute from two percentages in
            // their head.
            const lost = previous ? previous.count - stage.count : 0;
            return (
              <li key={stage.stage}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-xs text-foreground">{stage.label}</p>
                  <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatCount(stage.count)}
                    <span className="ml-1.5 text-[11px]">{stage.percentOfEntry}%</span>
                  </p>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
                    style={{
                      width: `${Math.max((stage.count / widest) * 100, stage.count > 0 ? 2 : 0)}%`,
                      backgroundColor: colorFor?.(index) ?? "var(--chart-1)"
                    }}
                  />
                </div>
                {lost > 0 ? (
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    −{formatCount(lost)} from “{previous?.label}”
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

// A single labelled proportion bar, for the places a whole funnel is overkill
// but a raw percentage is unreadable — cache hit rates, per-route error rates.
export function ProportionBar({
  percent,
  tone = "default",
  className
}: {
  percent: number;
  tone?: "default" | "warning" | "success";
  className?: string;
}) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none",
          tone === "warning" && "bg-destructive",
          tone === "success" && "bg-success",
          tone === "default" && "bg-primary"
        )}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}
