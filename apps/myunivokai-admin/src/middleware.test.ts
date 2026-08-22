import { describe, expect, it } from "vitest";
import { isAccessTokenFresh } from "./middleware";

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

// `exp` is the standard registered claim (Unix seconds) golang-jwt's
// RegisteredClaims actually signs — see the note on readAccessTokenExpiry.
function buildAccessToken(expiresAtMilliseconds: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "EdDSA" }));
  const payload = base64UrlEncode(JSON.stringify({ exp: Math.floor(expiresAtMilliseconds / 1000) }));
  return `${header}.${payload}.unsigned`;
}

describe("isAccessTokenFresh", () => {
  it("is fresh when exp is in the future", () => {
    expect(isAccessTokenFresh(buildAccessToken(Date.now() + 60_000))).toBe(true);
  });

  it("is not fresh when exp is in the past", () => {
    expect(isAccessTokenFresh(buildAccessToken(Date.now() - 60_000))).toBe(false);
  });

  it("is not fresh for a token that fails to decode", () => {
    expect(isAccessTokenFresh("garbage")).toBe(false);
  });
});
