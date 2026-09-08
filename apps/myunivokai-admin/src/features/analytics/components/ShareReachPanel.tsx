"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Eye, Link2Off, Send } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { telemetryApi } from "@/features/telemetry/api";
import { formatCount, formatPercent } from "../format";
import type { WorldFamily } from "../types";

// The two halves of the share funnel live in two services that never meet.
// analytics-service knows how many worlds are published; telemetry-service
// knows how many share pages were served. Separate databases, separate
// subjects, nothing joins them — and this browser is the only place both
// numbers already exist at once, which is why the join is here rather than in
// a query.
//
// Everything on this panel is therefore two independently-sampled measurements
// side by side, and every label says so. The one number it refuses to show is
// a "share rate": worlds published is a LIFETIME count of what is published
// right now, while pages served is a windowed count, so their quotient is an
// average per live page over the window and is labelled exactly that.

// Requests to a share page that answered 2xx are the only ones that showed
// anybody a world. The rest are mistyped slugs, unpublished or deleted worlds,
// and crawlers — and this is the platform's only unauthenticated route reached
// by a URL a stranger types, so it is the route where those actually arrive.
//
// How much of that traffic misses is unmeasured rather than known to be small:
// local history holds 7 share requests and all 7 succeeded, because nobody
// outside a developer machine has the links. Which is exactly why the number
// on this panel is `successCount` and not `requestCount` — the difference is
// invisible until the day it is not.
const SHARE_ROUTE_MARKER = "/share/worlds/";
const SHARE_ROUTE_METHOD = "GET";
const HOURS_PER_DAY = 24;

// telemetry-service refuses a window wider than a week
// (`contracts.TelemetryMaximumHours`), and the gateway clamps rather than
// erroring — so the response reports the window it ACTUALLY used. That value
// is read back below instead of being predicted here, which is what keeps this
// panel honest when the range picker above it asks for 30 or 90 days.
function requestedHoursFor(days: number): number {
  return days * HOURS_PER_DAY;
}

export function ShareReachPanel({
  days,
  family,
  publishedWorlds,
  isPublishedLoading
}: {
  days: number;
  family: "" | WorldFamily;
  publishedWorlds?: number;
  isPublishedLoading: boolean;
}) {
  const requestedHours = requestedHoursFor(days);
  const routesQuery = useQuery({
    queryKey: ["telemetry", "routes", requestedHours],
    queryFn: () => telemetryApi.routes(requestedHours),
    placeholderData: keepPreviousData
  });

  const shareRoutes = (routesQuery.data?.routes ?? []).filter(
    (route) =>
      route.routePattern.includes(SHARE_ROUTE_MARKER) &&
      route.method === SHARE_ROUTE_METHOD &&
      // A family filter selects that family's own share route. The pattern
      // carries the family as a literal segment — `/api/ocean/share/...` — so
      // this needs no lookup and gains a family the moment the gateway mounts
      // one.
      (family === "" || route.routePattern.startsWith(`/api/${family}/`))
  );

  const pagesServed = shareRoutes.reduce((total, route) => total + route.successCount, 0);
  const totalRequests = shareRoutes.reduce((total, route) => total + route.requestCount, 0);
  const deadLinkRequests = totalRequests - pagesServed;
  const deadLinkPercent = totalRequests > 0 ? (deadLinkRequests * 100) / totalRequests : 0;

  const measuredHours = routesQuery.data?.hours;
  // The window was narrowed by the store, not by this panel, and a reader
  // comparing these numbers to the range picker deserves to be told.
  const windowWasClamped = measuredHours !== undefined && measuredHours < requestedHours;
  const chartsAvailable = routesQuery.data?.chartsAvailable ?? true;

  const openingsPerPublishedWorld =
    publishedWorlds && publishedWorlds > 0 ? pagesServed / publishedWorlds : undefined;

  return (
    <SectionCard
      title="Share reach"
      description={
        measuredHours === undefined
          ? "How often a published world was actually opened by somebody, from the gateway's own request rollups."
          : `Share pages served over the last ${describeHours(measuredHours)}, from the gateway's request rollups — beside the number of worlds published right now. Two separate stores, two separate windows: this is an indicator, not a per-world attribution.`
      }
    >
      {!chartsAvailable ? (
        <EmptyState
          icon={Eye}
          title="Share reach cannot be drawn from this sink"
          description="telemetry-service is configured to forward to an external dashboard rather than store its own rollups, so it answers no range query. Set TELEMETRY_SINK=postgres to render this here."
        />
      ) : routesQuery.isError ? (
        <EmptyState
          icon={Eye}
          title="The route rollups are unavailable"
          description="telemetry-service did not answer. It may be starting up — an admin read never wakes a family service, but it does wake this one."
        />
      ) : routesQuery.isLoading ? (
        <Skeleton className="mt-3 h-[72px] rounded-lg" />
      ) : totalRequests === 0 ? (
        <EmptyState
          icon={Eye}
          title="No share page was requested in this window"
          description="Either nobody opened a share link, or TELEMETRY_ENABLED is off at the gateway — with it off nothing is ever published to the rollup stream."
        />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <ShareFigure
              icon={Eye}
              label="Share pages served"
              value={formatCount(pagesServed)}
              hint={`2xx only, of ${formatCount(totalRequests)} requests`}
            />
            <ShareFigure
              icon={Link2Off}
              label="Dead link requests"
              value={formatCount(deadLinkRequests)}
              hint={`${formatPercent(deadLinkPercent)} of share traffic — mistyped, deleted or crawled`}
            />
            <ShareFigure
              icon={Send}
              label="Published worlds"
              value={isPublishedLoading || publishedWorlds === undefined ? "—" : formatCount(publishedWorlds)}
              hint="published right now, all time"
            />
          </div>

          {openingsPerPublishedWorld === undefined ? null : (
            <p className="mt-3 text-xs text-muted-foreground">
              About {openingsPerPublishedWorld.toFixed(1)} openings per published world over these{" "}
              {describeHours(measuredHours ?? requestedHours)} — a windowed count of pages served
              divided by a lifetime count of pages that exist, so a world published yesterday
              lowers it as much as one nobody opened.
            </p>
          )}

          {windowWasClamped ? (
            <p className="mt-2 text-xs text-muted-foreground">
              The range above asks for {days} days; the rollup store keeps minute buckets and
              answers at most a week, so the share numbers cover{" "}
              {describeHours(measuredHours ?? requestedHours)} while &ldquo;published worlds&rdquo;
              covers everything.
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

// Hours read as hours up to a day and as days beyond it, because "168 hours"
// is a unit conversion the reader should not have to do to know it means a
// week.
function describeHours(hours: number): string {
  if (hours < HOURS_PER_DAY) {
    return `${hours} hours`;
  }
  const days = Math.round(hours / HOURS_PER_DAY);
  return days === 1 ? "24 hours" : `${days} days`;
}

function ShareFigure({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 truncate font-heading text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
