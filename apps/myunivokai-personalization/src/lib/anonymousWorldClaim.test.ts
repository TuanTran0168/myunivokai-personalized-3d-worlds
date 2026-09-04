import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { claimAnonymousWorldsForAccount } from "./anonymousWorldClaim";
import { installBrowserStorageStub, type BrowserStorageStub } from "./browserStorageStub";
import { claimAnonymousWorlds, resetRefreshInFlightForTesting } from "./productAuth";
import {
  PRODUCT_SESSION_COOKIE_NAMES,
  readAnonymousIdentifier,
  readOrCreateAnonymousIdentifier,
  writeProductSession
} from "./productSession";
import {
  accountOwnerKey,
  addWorldIdentifierToGallery,
  anonymousOwnerKey,
  readSavedWorldReferences
} from "./savedWorlds";

const ACCOUNT_IDENTIFIER = "9f1c2f7e-3b44-4a91-9f0e-6d2b7c8a1e55";
const ACCESS_TOKEN = "an-access-token";

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

function signIn(): void {
  writeProductSession({
    accessToken: ACCESS_TOKEN,
    accessExpiresAt: isoInstantInDays(7),
    refreshToken: `${ACCESS_TOKEN}-refresh`,
    refreshExpiresAt: isoInstantInDays(90),
    account: { accountId: ACCOUNT_IDENTIFIER, email: "visitor@example.com" }
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function headersOfCall(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Headers {
  const requestInit = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return new Headers(requestInit?.headers);
}

/**
 * Runs `api.createWorld` far enough to inspect the POST it sends, then lets it
 * fail on the poll that follows.
 *
 * What is under test here is one request's headers, not the generation loop
 * that api.test.ts already covers end to end. The rejection is asserted rather
 * than swallowed, and so is the call count: a `catch(() => undefined)` on its
 * own would also hide the create throwing before it ever reached the network,
 * which is exactly how this test passed for the wrong reason once already.
 */
async function abandonAfterTheCreateRequest(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  fetchMock.mockRejectedValueOnce(new Error("the poll is not what this test is about"));
  await expect(api.createWorld({} as never, "universe")).rejects.toThrow();
  expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
}

describe("claiming the worlds this browser made before it had an account", () => {
  it("sends the anonymous id as a header, with the session, and forgets it afterwards", async () => {
    const anonymousIdentifier = readOrCreateAnonymousIdentifier();
    signIn();
    addWorldIdentifierToGallery("world-made-anonymously", "universe", anonymousOwnerKey());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, { accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimAnonymousWorldsForAccount(ACCOUNT_IDENTIFIER);

    expect(result).toEqual({ claimAccepted: true, movedWorldCount: 1 });
    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain("/api/me/worlds/claim");
    const headers = headersOfCall(fetchMock, 0);
    expect(headers.get("X-Anonymous-Id")).toBe(anonymousIdentifier);
    // The account is never in the request. It comes from the token's subject,
    // which is what makes "my worlds" something this endpoint cannot express
    // wrongly rather than something it has to check.
    expect(headers.get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    // The credential is gone once it has been spent. It named worlds an
    // account now owns, so it unlocks nothing and would otherwise sit in a
    // JS-readable cookie for another 180 days.
    expect(readAnonymousIdentifier()).toBeNull();
  });

  it("moves the browser's gallery shelf, without which the claim is invisible", async () => {
    readOrCreateAnonymousIdentifier();
    signIn();
    addWorldIdentifierToGallery("world-one", "universe", anonymousOwnerKey());
    addWorldIdentifierToGallery("world-two", "nature", anonymousOwnerKey());
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, { accepted: true })));

    await claimAnonymousWorldsForAccount(ACCOUNT_IDENTIFIER);

    expect(readSavedWorldReferences(accountOwnerKey(ACCOUNT_IDENTIFIER)).map((entry) => entry.worldIdentifier)).toEqual([
      "world-two",
      "world-one"
    ]);
    expect(readSavedWorldReferences(anonymousOwnerKey())).toEqual([]);
    // The family travels with the entry. A world filed under the wrong family
    // is a gallery card that asks the wrong backend and renders nothing.
    expect(readSavedWorldReferences(accountOwnerKey(ACCOUNT_IDENTIFIER)).map((entry) => entry.family)).toEqual([
      "nature",
      "universe"
    ]);
  });

  it("keeps the anonymous id and the shelf when the server refused, so the next sign-in retries", async () => {
    const anonymousIdentifier = readOrCreateAnonymousIdentifier();
    signIn();
    addWorldIdentifierToGallery("world-one", "universe", anonymousOwnerKey());
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(503, { error: { code: "CLAIM_UNAVAILABLE", message: "no" } }))
    );

    await expect(claimAnonymousWorldsForAccount(ACCOUNT_IDENTIFIER)).rejects.toThrow();

    // Both halves untouched. Clearing either one on a failure would be a
    // permanent loss: nobody can prove they made an anonymous world, so the
    // cookie is the only thing that could ever claim it.
    expect(readAnonymousIdentifier()).toBe(anonymousIdentifier);
    expect(readSavedWorldReferences(anonymousOwnerKey()).map((entry) => entry.worldIdentifier)).toEqual(["world-one"]);
    expect(readSavedWorldReferences(accountOwnerKey(ACCOUNT_IDENTIFIER))).toEqual([]);
  });

  it("asks for nothing when this browser has no anonymous id at all", async () => {
    signIn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, { accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimAnonymousWorldsForAccount(ACCOUNT_IDENTIFIER);

    expect(result).toEqual({ claimAccepted: false, movedWorldCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    // And nothing was minted in order to claim with it. An id created here
    // would name worlds that cannot exist, and would then be cleared - a
    // round trip to move nothing.
    expect(readAnonymousIdentifier()).toBeNull();
  });

  it("does not touch the shelf when the session carried no account id", async () => {
    readOrCreateAnonymousIdentifier();
    signIn();
    addWorldIdentifierToGallery("world-one", "universe", anonymousOwnerKey());
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, { accepted: true })));

    const result = await claimAnonymousWorldsForAccount("");

    // The server claim happened - that is what the cookie clear records - but
    // the local shelf is left alone rather than filed under `account:`, a key
    // every account signing into this browser would share.
    expect(result).toEqual({ claimAccepted: true, movedWorldCount: 0 });
    expect(readAnonymousIdentifier()).toBeNull();
    expect(readSavedWorldReferences(anonymousOwnerKey()).map((entry) => entry.worldIdentifier)).toEqual(["world-one"]);
  });

  it("is a plain POST with no body, because both of its inputs are headers", async () => {
    readOrCreateAnonymousIdentifier();
    signIn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, { accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await claimAnonymousWorlds();

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.method).toBe("POST");
    expect(requestInit.body).toBeUndefined();
  });
});

describe("the anonymous id on a create", () => {
  it("is sent, and minted on first use, when nobody is signed in", async () => {
    expect(readAnonymousIdentifier()).toBeNull();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(202, { jobId: "job-1", family: "universe", status: "queued" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await abandonAfterTheCreateRequest(fetchMock);

    const sentIdentifier = headersOfCall(fetchMock, 0).get("X-Anonymous-Id");
    expect(sentIdentifier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // Minted here, and kept, so the visitor's next create carries the same one
    // and both worlds are claimable together.
    expect(readAnonymousIdentifier()).toBe(sentIdentifier);
    expect(stub?.cookieJar.has(PRODUCT_SESSION_COOKIE_NAMES.anonymousIdentifier)).toBe(true);
  });

  it("is not sent when there is a session, because the gateway would drop it", async () => {
    readOrCreateAnonymousIdentifier();
    signIn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(202, { jobId: "job-1", family: "universe", status: "queued" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await abandonAfterTheCreateRequest(fetchMock);

    const headers = headersOfCall(fetchMock, 0);
    expect(headers.get("X-Anonymous-Id")).toBeNull();
    expect(headers.get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    // Still in the cookie. Signing out does not clear it, and neither does
    // this: it names worlds made before the account existed.
    expect(readAnonymousIdentifier()).not.toBeNull();
  });
});
