"use client";

import { MonitorSmartphone, TriangleAlert } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatPercent } from "@/features/analytics/format";
import type { TelemetryClientRenderSummary } from "../types";

// The only numbers on any telemetry screen that the platform did not measure
// itself. Everything else here comes from the gateway; these come from
// browsers, which is why the description says so and why nothing keyed to
// money or access reads them.
//
// Two questions, one panel, because neither is worth a screen and each is
// unreadable without the other: what are visitors' devices capable of, and how
// often does the canvas fail outright. A failure count alone cannot say whether
// three failures is three unlucky desktops or every phone that tried.

const QUALITY_TIER_LABELS: Record<number, string> = {
  1: "Minimal",
  2: "Balanced",
  3: "High"
};

// Matches the tier order, and deliberately not a red/amber/green ramp: a
// minimal-tier device is not a fault, it is a phone. The failure row below is
// the only thing on this panel that earns a warning colour.
const QUALITY_TIER_COLORS: Record<number, string> = {
  1: "var(--chart-4)",
  2: "var(--chart-2)",
  3: "var(--chart-3)"
};

const RENDERED_OUTCOME = "rendered";
const WEBGL_FAILED_OUTCOME = "webgl_failed";

export function ClientRenderPanel({
  rows,
  isLoading
}: {
  rows: TelemetryClientRenderSummary[];
  isLoading: boolean;
}) {
  const renderedByTier = new Map<number, number>();
  let renderedTotal = 0;
  let failedTotal = 0;
  for (const row of rows) {
    if (row.outcome === WEBGL_FAILED_OUTCOME) {
      failedTotal += row.count;
      continue;
    }
    if (row.outcome !== RENDERED_OUTCOME) {
      // An outcome this screen does not know how to read is skipped rather
      // than lumped in. The backend's set is closed, so this can only happen
      // when it grows — and a new outcome silently counted as a success would
      // be worse than one temporarily missing.
      continue;
    }
    renderedByTier.set(row.qualityTier, (renderedByTier.get(row.qualityTier) ?? 0) + row.count);
    renderedTotal += row.count;
  }
  const reportTotal = renderedTotal + failedTotal;
  const tiers = [...renderedByTier.entries()].sort(([left], [right]) => left - right);

  return (
    <SectionCard
      title="What browsers reported"
      description="Client-reported, not measured here: a page tells the gateway which quality tier it resolved and whether its canvas rendered. Counts can be inflated by anyone who can reach the endpoint, so read them as a shape rather than a total."
    >
      {isLoading ? (
        <Skeleton className="mt-3 h-[120px] rounded-lg" />
      ) : reportTotal === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <MonitorSmartphone className="size-3.5" aria-hidden />
          No browser reported in this window. Either nobody opened a scene, or the pages serving
          them are older than the report.
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {tiers.map(([tier, count]) => (
              <li key={tier} className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: QUALITY_TIER_COLORS[tier] ?? "var(--chart-4)" }}
                    aria-hidden
                  />
                  {QUALITY_TIER_LABELS[tier] ?? `Tier ${tier}`}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatCount(count)} · {formatPercent((count * 100) / renderedTotal)}
                </span>
              </li>
            ))}
          </ul>

          <p
            className={`mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-xs ${
              failedTotal > 0 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              <TriangleAlert className="size-3.5" aria-hidden />
              Canvas never rendered
            </span>
            <span className="font-mono tabular-nums">
              {formatCount(failedTotal)} · {formatPercent((failedTotal * 100) / reportTotal)}
            </span>
          </p>
          {failedTotal > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              A lost or unavailable WebGL context. These visitors saw a stated failure rather than
              a blank rectangle, which is all the boundary can do — the scene did not run.
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
