// Mirrors contracts/go/contracts_auth.go's AccountSummary and the gateway's
// SessionResponse body (services/api-gateway/internal/handlers/admin_auth_handler.go).
// This file only holds isomorphic types/helpers (no server-only APIs) so both
// middleware.ts (edge runtime) and route handlers can import it.

export const ADMIN_ACCESS_COOKIE_NAME = "myunivokai_admin_access";
export const ADMIN_REFRESH_COOKIE_NAME = "myunivokai_admin_refresh";
// Not a gateway concept: the access/refresh tokens carry no permission list by
// design (see contracts_auth.go's AccessTokenClaims comment), and this phase
// intentionally ships no /session query endpoint (S4-AUTH-003's "narrower
// than scoped" note). This admin-app-only cookie caches the last login/
// refresh response's account summary so the nav can render without a network
// round trip on every request; it expires alongside the access token and is
// re-derived from a real refresh whenever both are stale.
export const ADMIN_ACCOUNT_COOKIE_NAME = "myunivokai_admin_account";

export type AccountKind = "staff" | "end_user";

export interface AccountSummary {
  accountId: string;
  email: string;
  name?: string;
  kind: AccountKind;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  disabled: boolean;
  forcePasswordChange: boolean;
  createdAt: string;
}

export interface SessionResponse {
  account: AccountSummary;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

// PermissionCode values, ported from contracts/go/contracts_auth.go. Declared
// in Go and synced to the database; this app only reads them, never invents
// its own — see notes/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
export const PERMISSIONS = {
  worldRead: "world:read",
  worldUnpublish: "world:unpublish",
  variantRead: "variant:read",
  jobRead: "job:read",
  jobRetry: "job:retry",
  profileRead: "profile:read",
  profileReveal: "profile:reveal",
  chartRead: "chart:read",
  accountRead: "account:read",
  accountManage: "account:manage",
  auditRead: "audit:read",
  roleRead: "role:read",
  roleManage: "role:manage"
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// The account-summary cookie's value is JSON, which contains characters
// (`"`, `:`, `,`) that RFC 6265's cookie-octet grammar excludes from a raw
// Cookie/Set-Cookie value. Every writer and every reader of this cookie goes
// through these two functions so the encoding is applied exactly once each
// way, regardless of whether the value travels via a real Set-Cookie header
// or a splice into middleware's forwarded request headers.
export function encodeAccountCookieValue(account: AccountSummary): string {
  return encodeURIComponent(JSON.stringify(account));
}

export function decodeAccountCookieValue(rawValue: string): AccountSummary | null {
  try {
    return JSON.parse(decodeURIComponent(rawValue)) as AccountSummary;
  } catch {
    return null;
  }
}

// Reads the account-summary cookie straight from document.cookie, for client
// components that need it without a server component reading cookies() on
// their behalf — see (dashboard)/layout.tsx's comment on why that layout
// deliberately stopped doing that. Safe to call during SSR (returns null,
// same as "not logged in yet") since `document` does not exist there.
export function readAccountCookie(): AccountSummary | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_ACCOUNT_COOKIE_NAME}=([^;]*)`));
  return match ? decodeAccountCookieValue(match[1]) : null;
}

export function hasPermission(account: AccountSummary | null, code: PermissionCode): boolean {
  if (!account) {
    return false;
  }
  // isSuperAdmin is a bypass flag, not a role — nothing is seeded "for" it
  // beyond the bootstrap account (see sprint-04 user-stories.md S4-AUTH-002).
  return account.isSuperAdmin || account.permissions.includes(code);
}

// Decodes the access JWT's payload to read its standard `exp` registered
// claim (a NumericDate — Unix seconds, per RFC 7519 and golang-jwt's
// RegisteredClaims, which is what services/auth-service/internal/security/tokens.go
// actually signs), WITHOUT verifying the Ed25519 signature. This is a
// UX-only check (should the app bother trying to render as logged-in, or
// send the user to /login) — it is never a security boundary. The actual
// boundary is the gateway's own signature + Redis tokenVersion check on
// every request that matters (RequireAdminAccessToken), same as
// notes/plans/services/auth-and-admin-plan.md#how-b-works describes for the
// gateway's own edge. Note this is distinct from contracts.AccessTokenClaims'
// `expiresAt` field, which only exists on the Go-side struct auth-service
// builds AFTER parsing the token — it is not a claim name on the wire.
export function readAccessTokenExpiry(accessToken: string): number | null {
  const segments = accessToken.split(".");
  if (segments.length !== 3) {
    return null;
  }
  try {
    const payloadJson = base64UrlDecode(segments[1]);
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  // atob is available in both the edge runtime and modern browsers; route
  // handlers run in Node, which also provides it as a global since Node 16.
  return decodeURIComponent(
    atob(padded)
      .split("")
      .map((character) => "%" + character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
}
