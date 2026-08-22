import { formatCount, formatPercent } from "@/features/analytics/format";
import type { TelemetryCacheSummary } from "../types";

// Whether the three Redis namespaces are earning their keep. README.md has
// always documented that they exist and how they are invalidated; their hit
// rate has never been measured until now.
export function CacheHitRateList({ cache }: { cache: TelemetryCacheSummary[] }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {cache.map((namespace) => (
        <div key={namespace.namespace} className="rounded-lg border border-border/60 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-mono text-xs text-foreground">{namespace.namespace}</p>
            <p className="text-sm font-medium tabular-nums text-foreground">
              {formatPercent(namespace.hitRatePercent)}
            </p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(namespace.hitRatePercent)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatCount(namespace.hits)} hit{namespace.hits === 1 ? "" : "s"} ·{" "}
            {formatCount(namespace.misses)} miss{namespace.misses === 1 ? "" : "es"}
          </p>
        </div>
      ))}
    </div>
  );
}
