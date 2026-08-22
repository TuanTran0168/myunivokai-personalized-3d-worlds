import { adminRequest } from "@/lib/admin-http";
import type { TelemetryOverview, TelemetryRouteList } from "./types";

// Two calls, no filters beyond the window. The per-route table is bounded by
// the gateway's route count rather than by traffic, so it needs no pagination
// and no search — which is why this file is a fraction of the size of the
// analytics one.
export const telemetryApi = {
  overview: (hours: number) => adminRequest<TelemetryOverview>(`/telemetry/overview?hours=${hours}`),
  routes: (hours: number) => adminRequest<TelemetryRouteList>(`/telemetry/routes?hours=${hours}`)
};
