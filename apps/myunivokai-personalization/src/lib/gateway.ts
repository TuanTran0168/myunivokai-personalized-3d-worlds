import type { WorldFamily } from "./types";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:41800";
const GATEWAY_ENVIRONMENT_VARIABLE_NAME = "NEXT_PUBLIC_GATEWAY_BASE_URL";
const SUPPORTED_GATEWAY_PROTOCOLS = new Set(["http:", "https:"]);

const API_PATH_PREFIX_BY_FAMILY: Record<WorldFamily, string> = {
  universe: "/api/universe",
  nature: "/api/nature",
  ocean: "/api/ocean"
};

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

const configuredGatewayBaseUrl = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.trim();
const GATEWAY_BASE_URL = normalizeGatewayBaseUrl(configuredGatewayBaseUrl || DEFAULT_GATEWAY_BASE_URL);

export function buildGatewayApiBaseUrl(gatewayBaseUrl: string, family: WorldFamily): string {
  return `${normalizeGatewayBaseUrl(gatewayBaseUrl)}${API_PATH_PREFIX_BY_FAMILY[family]}`;
}

// The path a family's routes live under, without an origin. The session-aware
// request helper prefixes the origin itself, so world calls and identity calls
// resolve it in exactly one place.
export function apiPathPrefixForFamily(family: WorldFamily): string {
  return API_PATH_PREFIX_BY_FAMILY[family];
}

export function apiBaseUrlForFamily(family: WorldFamily): string {
  return `${GATEWAY_BASE_URL}${API_PATH_PREFIX_BY_FAMILY[family]}`;
}

export function gatewayOriginUrl(): string {
  return GATEWAY_BASE_URL;
}
