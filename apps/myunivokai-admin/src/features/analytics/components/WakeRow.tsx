import { Badge } from "@/components/ui/badge";
import { serviceDisplayName } from "@/lib/service-names";
import { formatCount, formatDateTime } from "../format";
import type { ServiceWakeStats } from "../types";

// A service that is not wakeable reports a flat zero for reasons that have
// nothing to do with its health, so it is labelled rather than scored. Without
// that distinction "0 wakes" reads as "never slept" when it means "never
// covered".
export function WakeRow({ stats }: { stats: ServiceWakeStats }) {
  const stranded = stats.consecutiveFailedWakes > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{serviceDisplayName(stats.service)}</p>
        <p className="truncate text-xs text-muted-foreground">
          Last seen {formatDateTime(stats.lastSeenAt ?? undefined)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {stats.wakeable ? (
          <Badge variant="ghost">{formatCount(stats.totalWakes)} wakes</Badge>
        ) : (
          <Badge variant="secondary">not wakeable</Badge>
        )}
        {stranded ? (
          <Badge variant="destructive">{stats.consecutiveFailedWakes} failed in a row</Badge>
        ) : (
          <Badge variant="outline">answering</Badge>
        )}
      </div>
    </div>
  );
}
