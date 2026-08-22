import { describe, expect, it } from "vitest";
import {
  decodeAccountCookieValue,
  encodeAccountCookieValue,
  hasPermission,
  PERMISSIONS,
  readAccessTokenExpiry,
  type AccountSummary
} from "./session";

function buildAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    accountId: "acct_1",
    email: "staff@myunivokai.dev",
    kind: "staff",
    roles: ["analyst"],
    permissions: [PERMISSIONS.chartRead],
    isSuperAdmin: false,
    disabled: false,
    forcePasswordChange: false,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

// A hand-built JWT with no real signature: readAccessTokenExpiry only ever
// reads the payload segment, and deliberately never verifies the signature
// (that is the gateway's job — see the comment on the function itself).
// `exp` is the standard registered claim (Unix seconds), matching what
// golang-jwt's RegisteredClaims actually signs.
function buildAccessToken(expiresAtMilliseconds: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({ sub: "acct_1", exp: Math.floor(expiresAtMilliseconds / 1000) }));
  return `${header}.${payload}.unsigned`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

describe("hasPermission", () => {
  it("returns false for a null account", () => {
    expect(hasPermission(null, PERMISSIONS.chartRead)).toBe(false);
  });

  it("checks the account's own permission list", () => {
    const account = buildAccount({ permissions: [PERMISSIONS.worldRead] });
    expect(hasPermission(account, PERMISSIONS.worldRead)).toBe(true);
    expect(hasPermission(account, PERMISSIONS.accountManage)).toBe(false);
  });

  it("treats isSuperAdmin as a bypass, not a role to grant", () => {
    const account = buildAccount({ permissions: [], isSuperAdmin: true });
    expect(hasPermission(account, PERMISSIONS.roleManage)).toBe(true);
  });
});

describe("account cookie encoding", () => {
  it("round-trips an account summary containing cookie-unsafe characters", () => {
    const account = buildAccount({ email: "staff+test@myunivokai.dev", roles: ["a,b", 'c"d'] });
    const encoded = encodeAccountCookieValue(account);
    expect(encoded).not.toMatch(/[",;]/);
    expect(decodeAccountCookieValue(encoded)).toEqual(account);
  });

  it("returns null for a value that is not valid JSON", () => {
    expect(decodeAccountCookieValue("not-json")).toBeNull();
  });
});

describe("readAccessTokenExpiry", () => {
  it("reads the exp claim from the token payload, in milliseconds", () => {
    const expiresAtMilliseconds = Date.parse("2026-08-06T12:00:00.000Z");
    expect(readAccessTokenExpiry(buildAccessToken(expiresAtMilliseconds))).toBe(expiresAtMilliseconds);
  });

  it("returns null for a malformed token", () => {
    expect(readAccessTokenExpiry("not-a-jwt")).toBeNull();
  });

  it("returns null when the payload has no exp claim", () => {
    const payload = base64UrlEncode(JSON.stringify({ sub: "acct_1" }));
    expect(readAccessTokenExpiry(`header.${payload}.sig`)).toBeNull();
  });
});
