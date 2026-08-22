// Both BFF relays (src/lib/auth-relay.ts and the generic
// src/app/api/admin/[...path]/route.ts) rebuild the gateway's response rather
// than streaming it through, so every header they want the browser to see has
// to be named here.
//
// Retry-After is the one that matters beyond Content-Type: it carries the
// gateway's wait hint for both SERVICE_WAKING and RATE_LIMITED, and
// src/lib/wake-retry.ts reads it to decide when to try again. Dropped, the
// browser falls back to guessing.
const FORWARDED_HEADERS = ["Content-Type", "Retry-After"];

export function forwardedRelayHeaders(gatewayResponse: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const headerName of FORWARDED_HEADERS) {
    const value = gatewayResponse.headers.get(headerName);
    if (value) {
      headers[headerName] = value;
    }
  }
  return headers;
}
