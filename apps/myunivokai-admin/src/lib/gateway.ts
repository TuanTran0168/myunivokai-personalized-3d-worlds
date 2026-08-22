// Server-only: unlike apps/myunivokai-web's lib/gateway.ts, this app's
// browser never talks to the gateway directly (see the BFF note in
// src/app/api/admin/auth/*/route.ts) — only this app's own server does, so
// the base URL is a plain server env var, never a NEXT_PUBLIC_ one.
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:41800";
const GATEWAY_ENVIRONMENT_VARIABLE_NAME = "ADMIN_GATEWAY_BASE_URL";
const SUPPORTED_GATEWAY_PROTOCOLS = new Set(["http:", "https:"]);

// Ported from apps/myunivokai-web/src/lib/gateway.ts's normalizeGatewayBaseUrl —
// same validation, same reasoning (bare origin only, no credentials/path/query/fragment).
export function normalizeGatewayBaseUrl(value: string): string {
  let parsedGatewayUrl: URL;
  try {
    parsedGatewayUrl = new URL(value);
  } catch {
    throw new Error(`${GATEWAY_ENVIRONMENT_VARIABLE_NAME} must be an absolute HTTP or HTTPS origin.`);
  }

  const hasRootPathOnly = parsedGatewayUrl.pathname === "/";
  const hasUnsupportedComponents =
    parsedGatewayUrl.username !== "" ||
    parsedGatewayUrl.password !== "" ||
    parsedGatewayUrl.search !== "" ||
    parsedGatewayUrl.hash !== "";

  if (
    !SUPPORTED_GATEWAY_PROTOCOLS.has(parsedGatewayUrl.protocol) ||
    !hasRootPathOnly ||
    hasUnsupportedComponents
  ) {
    throw new Error(
      `${GATEWAY_ENVIRONMENT_VARIABLE_NAME} must contain only an absolute HTTP or HTTPS origin without credentials, path, query, or fragment.`
    );
  }

  return parsedGatewayUrl.origin;
}

export function gatewayOriginUrl(): string {
  const configuredGatewayBaseUrl = process.env.ADMIN_GATEWAY_BASE_URL?.trim();
  return normalizeGatewayBaseUrl(configuredGatewayBaseUrl || DEFAULT_GATEWAY_BASE_URL);
}
