// One place to turn a backend's own key (what it calls itself in a NATS
// subject, a wake-stats row or a service-starts row — see
// services/api-gateway/internal/wake/platform.go's `Services` list) into the
// name a reader sees. Every raw key this repo produces resolves here rather
// than being title-cased on the spot, so "auth" and "auth-service" always
// read the same way no matter which response shape happened to carry it.
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  gateway: "API Gateway",
  "api-gateway": "API Gateway",
  dna: "DNA Service",
  "dna-service": "DNA Service",
  universe: "Universe Service",
  "universe-service": "Universe Service",
  nature: "Nature Service",
  "nature-service": "Nature Service",
  ocean: "Ocean Service",
  "ocean-service": "Ocean Service",
  auth: "Auth Service",
  "auth-service": "Auth Service",
  analytics: "Analytics Service",
  "analytics-service": "Analytics Service",
  telemetry: "Telemetry Service",
  "telemetry-service": "Telemetry Service"
};

/** Falls back to the raw key so an unmapped future service still renders something. */
export function serviceDisplayName(key: string): string {
  return SERVICE_DISPLAY_NAMES[key] ?? key;
}
