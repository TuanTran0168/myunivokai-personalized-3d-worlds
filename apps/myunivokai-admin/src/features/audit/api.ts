import { adminRequest } from "@/lib/admin-http";
import type { AuditEventPage, AuditListFilters } from "./types";

// dayStart/dayEnd turn a "YYYY-MM-DD" filter value into the RFC3339 instant
// bounding that whole local calendar day — duplicated from
// features/analytics/api.ts rather than shared, per this app's convention of
// keeping small per-feature helpers independent (see format.ts in both
// features).
function dayStart(day?: string): string | undefined {
  return day ? `${day}T00:00:00.000Z` : undefined;
}

function dayEnd(day?: string): string | undefined {
  return day ? `${day}T23:59:59.999Z` : undefined;
}

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

export const auditApi = {
  list: (filters: AuditListFilters, pageSize: number, cursor?: string) =>
    adminRequest<AuditEventPage>(
      `/audit${buildQuery({
        pageSize,
        cursor,
        since: dayStart(filters.since),
        until: dayEnd(filters.until),
        q: filters.search
      })}`
    )
};
