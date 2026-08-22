import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatDuration, formatPercent } from "@/features/analytics/format";
import type { TelemetryRouteSummary } from "../types";

// The error rate above which a row is called out rather than merely reported.
// 5xx only, so anything sustained here is the platform's own fault and not a
// client sending nonsense.
const NOTABLE_ERROR_RATE_PERCENT = 1;

export const ROUTE_TABLE_HEADERS = ["Route", "Method", "Requests", "Error rate", "Average", "p95", "Slowest"];

// One row per route TEMPLATE and method — /api/universe/worlds/{worldID},
// never a path carrying a world id. That rule is what keeps this table bounded
// by the gateway's route count rather than by traffic, which is also why it
// needs no pagination.
export function RoutesTable({ routes }: { routes: TelemetryRouteSummary[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              {ROUTE_TABLE_HEADERS.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => (
              <TableRow key={`${route.method} ${route.routePattern}`}>
                <TableCell className="font-mono text-xs">{route.routePattern}</TableCell>
                <TableCell>
                  <Badge variant="outline">{route.method}</Badge>
                </TableCell>
                <TableCell className="tabular-nums">{formatCount(route.requestCount)}</TableCell>
                <TableCell className="tabular-nums">
                  <span
                    className={
                      route.errorRatePercent >= NOTABLE_ERROR_RATE_PERCENT ? "text-destructive" : undefined
                    }
                  >
                    {formatPercent(route.errorRatePercent)}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatDuration(route.averageDurationMs)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatDuration(route.p95DurationMs)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatDuration(route.slowestDurationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* The same rows as cards below the lg breakpoint, mirroring how the
          analytics tables handle narrow screens: a seven-column table on a
          phone is a horizontal scroll nobody performs. */}
      <div className="flex flex-col gap-2 lg:hidden">
        {routes.map((route) => (
          <div
            key={`${route.method} ${route.routePattern}`}
            className="rounded-lg border border-border/60 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-all font-mono text-xs text-foreground">{route.routePattern}</p>
              <Badge variant="outline" className="shrink-0">
                {route.method}
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Requests</dt>
                <dd className="tabular-nums">{formatCount(route.requestCount)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Error rate</dt>
                <dd
                  className={
                    route.errorRatePercent >= NOTABLE_ERROR_RATE_PERCENT
                      ? "tabular-nums text-destructive"
                      : "tabular-nums"
                  }
                >
                  {formatPercent(route.errorRatePercent)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">p95</dt>
                <dd className="tabular-nums">{formatDuration(route.p95DurationMs)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Slowest</dt>
                <dd className="tabular-nums">{formatDuration(route.slowestDurationMs)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
