import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { installBrowserStorageStub, type BrowserStorageStub } from "./browserStorageStub";
import { resetRefreshInFlightForTesting } from "./productAuth";
import { writeProductSession } from "./productSession";

const WORLD_IDENTIFIER = "11111111-1111-4111-8111-111111111111";
const ACCESS_TOKEN = "an-access-token";
const REFRESHED_ACCESS_TOKEN = "a-refreshed-access-token";

let stub: BrowserStorageStub | null = null;

beforeEach(() => {
  stub = installBrowserStorageStub();
  resetRefreshInFlightForTesting();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.restoreAllMocks();
});

function isoInstantInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function signIn(accessToken: string): void {
  writeProductSession({
    accessToken,
    accessExpiresAt: isoInstantInDays(7),
    refreshToken: `${accessToken}-refresh`,
    refreshExpiresAt: isoInstantInDays(90),
    account: { accountId: "account-1", email: "visitor@example.com" }
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function authorizationHeaderOfCall(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): string | null {
  const requestInit = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  const headers = new Headers(requestInit?.headers);
  return headers.get("Authorization");
}

// The half of ownership that lives in the browser. The gateway sets the owner
// from a verified token, so a world call that carries no token produces a world
// with no owner - correct for a visitor who has not signed up, and a silent
// loss for one who has.
describe("a world call and the session", () => {
  it("sends nothing when nobody is signed in, so anonymous creation is untouched", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, { shareSlug: "neo-1", shareUrl: "http://localhost/share/neo-1" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.publishWorld(WORLD_IDENTIFIER);

    expect(authorizationHeaderOfCall(fetchMock, 0)).toBeNull();
  });

  it("carries the access token when somebody is", async () => {
    signIn(ACCESS_TOKEN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, { shareSlug: "neo-1", shareUrl: "http://localhost/share/neo-1" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.publishWorld(WORLD_IDENTIFIER);

    expect(authorizationHeaderOfCall(fetchMock, 0)).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  // The case that decides whether ownership survives ordinary use. An access
  // token lasts seven days, so a returning visitor's first world call of the
  // week is made with an expired one. Without the refresh the gateway answers
  // 401 and the visitor is told to sign in again on a page they were already
  // signed in to.
  it("refreshes once and retries with the new token when the old one has expired", async () => {
    signIn(ACCESS_TOKEN);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "A valid session is required." } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: REFRESHED_ACCESS_TOKEN,
          accessExpiresAt: isoInstantInDays(7),
          refreshToken: "a-new-refresh-token",
          refreshExpiresAt: isoInstantInDays(90),
          account: { accountId: "account-1", email: "visitor@example.com" }
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { shareSlug: "neo-1", shareUrl: "http://localhost/share/neo-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.publishWorld(WORLD_IDENTIFIER);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authorizationHeaderOfCall(fetchMock, 0)).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(authorizationHeaderOfCall(fetchMock, 2)).toBe(`Bearer ${REFRESHED_ACCESS_TOKEN}`);
  });
});
