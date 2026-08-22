"use client";

import { MoonStar, ServerCrash, TriangleAlert } from "lucide-react";
import { FunnelChart } from "@/components/ui/funnel-chart";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { formatCount, formatDateTime, formatPercent } from "@/features/analytics/format";
import { TelemetryShell } from "./components/TelemetryShell";
import { formatWindow } from "./format";
import { useTelemetryWindow } from "./useTelemetryWindow";

// Colours by meaning, not by position: what arrived is neutral, what the
// client asked for correctly is the accent, and what this platform actually
// served is the success colour — the only stage that is this platform's own
// achievement.
const FUNNEL_STAGE_COLORS = ["var(--chart-4)", "var(--chart-2)", "var(--chart-3)"];

// What failed, what was asleep, and how much traffic survived the whole path.
//
// SERVICE_WAKING is on this screen rather than on Traffic because it is not a
// fault and not volume — it is the cost of scale-to-zero, and it belongs beside
// the errors it is constantly mistaken for.
export function ReliabilityPage() {
  const [hours, setHours] = useTelemetryWindow();

  return (
    <TelemetryShell
      title="Reliability"
      description="What failed, what was asleep, and how much of the traffic made it through the whole request path."
      hours={hours}
      onHoursChange={setHours}
    >
      {(overview, isLoading) => {
        const comparison = overview?.comparison;
        const periodLabel = `the previous ${formatWindow(hours).replace("last ", "")}`;
        const wakeSignals = overview?.wakeSignals ?? [];
        const wakeTotal = wakeSignals.reduce((sum, point) => sum + point.requestCount, 0);
        const backendErrors = (overview?.backends ?? []).reduce(
          (sum, backend) => sum + backend.errorCount,
          0
        );

        return (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                icon={TriangleAlert}
                label="Server error rate"
                value={overview ? formatPercent(overview.errorRatePercent) : "—"}
                hint={overview ? `${formatCount(overview.errorRequests)} responses in the 5xx class` : undefined}
                tone={overview && overview.errorRatePercent > 0 ? "warning" : "default"}
                delta={comparison?.errors}
                deltaHigherIsBetter={false}
                deltaPeriodLabel={periodLabel}
              />
              <StatCard
                icon={ServerCrash}
                label="Backend failures"
                value={overview ? formatCount(backendErrors) : "—"}
                hint="no-responders and deadline exceeded included"
                tone={backendErrors > 0 ? "warning" : "default"}
              />
              <StatCard
                icon={MoonStar}
                label="Cold-start responses"
                value={overview ? formatCount(wakeTotal) : "—"}
                // Deliberately not tone="warning". A SERVICE_WAKING is the
                // free tier working as designed, and colouring it as a fault
                // would train an operator to treat the normal case as an
                // incident.
                hint="SERVICE_WAKING — the cost of scale-to-zero, not a fault"
              />
            </div>

            <FunnelChart
              title="Request funnel"
              description="How far the traffic got. Each stage strictly contains the next: everything that arrived, the part of it the client asked for correctly (4xx removed), and the part of that this platform answered (5xx removed). The drop between the first two is the client's problem; the drop between the last two is ours."
              stages={overview?.trafficFunnel ?? []}
              isLoading={isLoading}
              formatCount={formatCount}
              colorFor={(index) => FUNNEL_STAGE_COLORS[index] ?? "var(--chart-1)"}
              emptyLabel="Nothing reached the gateway in this window."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Error codes"
                description="The gateway's own codes, busiest first. SERVICE_WAKING here is a cold start, not a fault."
              >
                {isLoading ? (
                  <Skeleton className="mt-3 h-[120px] rounded-lg" />
                ) : (overview?.errorCodeTop ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No request produced an error body in this window.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {(overview?.errorCodeTop ?? []).map((entry) => (
                      <li key={entry.errorCode} className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-xs text-foreground">{entry.errorCode}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCount(entry.count)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Wake signals"
                description="How often the gateway answered SERVICE_WAKING. An approximation of the wake-conversion rate joined on time proximity, not a per-request causal trace — it says a wake was signalled, not that the retry succeeded."
              >
                {isLoading ? (
                  <Skeleton className="mt-3 h-[120px] rounded-lg" />
                ) : wakeSignals.length === 0 ? (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <MoonStar className="size-3.5" aria-hidden />
                    No request found a sleeping service in this window.
                  </p>
                ) : (
                  <ul className="mt-3 flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
                    {wakeSignals.map((point) => (
                      <li key={point.bucketStart} className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(point.bucketStart)}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatCount(point.requestCount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </>
        );
      }}
    </TelemetryShell>
  );
}
