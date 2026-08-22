import { adminRequest } from "@/lib/admin-http";
import type {
  JobListFilters,
  JobPage,
  Overview,
  ServiceStartPage,
  Timeseries,
  WakeStats,
  WorldDetail,
  WorldListFilters,
  WorldPage
} from "./types";

// dayStart/dayEnd turn a "YYYY-MM-DD" filter value into the RFC3339 instant
// bounding that whole local calendar day, so "since 2026-08-01" includes
// everything from its first moment and "until 2026-08-01" includes its last.
function dayStart(day?: string): string | undefined {
  return day ? `${day}T00:00:00.000Z` : undefined;
}

function dayEnd(day?: string): string | undefined {
  return day ? `${day}T23:59:59.999Z` : undefined;
}

// buildQuery drops empty values rather than sending `?family=`: the gateway
// treats an empty string as "no filter" anyway, but omitting it keeps the
// React Query cache key and the request URL in agreement, so two logically
// identical filter states do not become two cache entries.
function buildQuery(parameters: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined || value === "") {
      continue;
    }
    query.set(name, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const analyticsApi = {
  overview: (days: number, family?: string) =>
    adminRequest<Overview>(`/overview${buildQuery({ days, family })}`),

  timeseries: (days: number, family?: string) =>
    adminRequest<Timeseries>(`/timeseries${buildQuery({ days, family })}`),

  worlds: (filters: WorldListFilters, pageSize: number, cursor?: string) =>
    adminRequest<WorldPage>(
      `/worlds${buildQuery({
        pageSize,
        cursor,
        family: filters.family,
        archetype: filters.archetype,
        worldStyle: filters.worldStyle,
        mood: filters.mood,
        published: filters.published,
        rareFeature: filters.rareFeature,
        since: dayStart(filters.since),
        until: dayEnd(filters.until),
        q: filters.search
      })}`
    ),

  // encodeURIComponent guards the one segment here that is not a literal. The
  // id comes from a URL the operator can edit, and analytics-service answers
  // 404 for anything that is not a world — but a raw slash would change which
  // gateway route is hit before that judgement is ever reached.
  world: (worldId: string) => adminRequest<WorldDetail>(`/worlds/${encodeURIComponent(worldId)}`),

  jobs: (filters: JobListFilters, pageSize: number, cursor?: string) =>
    adminRequest<JobPage>(
      `/jobs${buildQuery({
        pageSize,
        cursor,
        family: filters.family,
        status: filters.status,
        since: dayStart(filters.since),
        until: dayEnd(filters.until),
        q: filters.search
      })}`
    ),

  serviceStarts: (service: string, pageSize: number, cursor?: string) =>
    adminRequest<ServiceStartPage>(`/service-starts${buildQuery({ pageSize, cursor, service })}`),

  wakeStats: (days: number) => adminRequest<WakeStats>(`/wake-stats${buildQuery({ days })}`)
};
