import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { installBrowserStorageStub, type BrowserStorageStub } from "./browserStorageStub";
import {
  authorizedGatewayRequest,
  isColdStartFailure,
  isCredentialFailure,
  refreshProductSession,
  resetRefreshInFlightForTesting,
  signIn,
  signOut
} from "./productAuth";
import { hasProductSession, readProductAccessToken, writeProductSession } from "./productSession";

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

function sessionPayload(accessToken: string) {
  return {
    accessToken,
    accessExpiresAt: isoInstantInDays(7),
    refreshToken: `${accessToken}-refresh`,
    refreshExpiresAt: isoInstantInDays(90),
    account: { accountId: "account-1", email: "visitor@example.com" }
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body)
  } as unknown as Response;
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: code } });
}

function seedSignedInSession(): void {
  writeProductSession({
    ...sessionPayload("the-original-access-token"),
    account: { accountId: "account-1", email: "visitor@example.com" }
  });
}

describe("signing in", () => {
  it("stores the returned session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, sessionPayload("a-fresh-token")));
    vi.stubGlobal("fetch", fetchMock);

    await signIn({ email: "visitor@example.com", password: "a-perfectly-fine-passphrase" });

    expect(readProductAccessToken()).toBe("a-fresh-token");
    expect(hasProductSession()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/auth/login");
  });
});

describe("authorized requests", () => {
  it("attaches the access token by hand rather than relying on the browser", async () => {
    seedSignedInSession();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { accountId: "account-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await authorizedGatewayRequest("/api/me");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((requestInit.headers as Record<string, string>).Authorization).toBe("Bearer the-original-access-token");
    // No credentials mode anywhere: nothing the browser attaches on its own is
    // part of this design, which is why it has no CSRF surface.
    expect(requestInit.credentials).toBeUndefined();
  });

  it("refreshes once on an expired token and retries the original request", async () => {
    seedSignedInSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"))
      .mockResolvedValueOnce(jsonResponse(200, sessionPayload("a-rotated-token")))
      .mockResolvedValueOnce(jsonResponse(200, { accountId: "account-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const account = await authorizedGatewayRequest<{ accountId: string }>("/api/me");

    expect(account.accountId).toBe("account-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/api/auth/refresh");
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer a-rotated-token");
  });

  // The one that matters most, and not for tidiness. The refresh token is
  // SINGLE USE with family-wide reuse detection, so two parallel refreshes
  // present the same token twice - and auth-service correctly reads the second
  // as an intercepted response and revokes the whole family. Without
  // single-flight, a page that makes two authenticated requests at once signs
  // the visitor out.
  it("collapses concurrent expiries onto one refresh", async () => {
    seedSignedInSession();
    let refreshCallCount = 0;
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/api/auth/refresh")) {
        refreshCallCount += 1;
        return jsonResponse(200, sessionPayload("a-rotated-token"));
      }
      // Every first attempt is unauthenticated; the retry carries the rotated
      // token and succeeds.
      return jsonResponse(200, { accountId: "account-1" });
    });
    const unauthorizedFirst = vi.fn(async (url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (!String(url).includes("/api/auth/refresh") && authorization === "Bearer the-original-access-token") {
        return errorResponse(401, "UNAUTHENTICATED");
      }
      return fetchMock(url, init);
    });
    vi.stubGlobal("fetch", unauthorizedFirst);

    await Promise.all([
      authorizedGatewayRequest("/api/me"),
      authorizedGatewayRequest("/api/me"),
      authorizedGatewayRequest("/api/me"),
      authorizedGatewayRequest("/api/me")
    ]);

    expect(refreshCallCount).toBe(1);
  });

  it("gives up rather than looping when the refresh is refused", async () => {
    seedSignedInSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"))
      .mockResolvedValueOnce(errorResponse(401, "INVALID_REFRESH_TOKEN"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizedGatewayRequest("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A refused refresh means the session is over, so nothing may keep
    // presenting a token the server has already rejected.
    expect(hasProductSession()).toBe(false);
  });

  // A 403 is a real answer about a real session - the account was disabled -
  // and refreshing would neither fix it nor be honest about it.
  it("does not treat a non-401 failure as an expired token", async () => {
    seedSignedInSession();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(403, "ACCOUNT_DISABLED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizedGatewayRequest("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasProductSession()).toBe(true);
  });
});

describe("refreshing", () => {
  // A cold gateway or a dropped connection is not a rejected session.
  // Clearing on one would sign people out for a network blip.
  it("keeps the session when the refresh fails in transport", async () => {
    seedSignedInSession();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(refreshProductSession()).rejects.toBeInstanceOf(TypeError);
    expect(hasProductSession()).toBe(true);
  });

  it("answers null rather than calling the gateway when there is nothing to refresh", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshProductSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  // A visitor who pressed sign out and got a network error must not be left
  // holding a working session.
  it("clears the local session even when the call fails", async () => {
    seedSignedInSession();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(signOut()).rejects.toBeInstanceOf(TypeError);
    expect(hasProductSession()).toBe(false);
  });

  it("revokes the family server-side before clearing", async () => {
    seedSignedInSession();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, {}));
    vi.stubGlobal("fetch", fetchMock);

    await signOut();

    expect(fetchMock.mock.calls[0][0]).toContain("/api/auth/logout");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).refreshToken).toBe(
      "the-original-access-token-refresh"
    );
    expect(hasProductSession()).toBe(false);
  });
});

// S8-IDENTITY-005 in one pair of predicates. A form that shows "something went
// wrong" for a cold start is lying; a form that shows "starting up" for a wrong
// password is worse. The two must never share a message.
describe("telling a cold start apart from a rejected credential", () => {
  it("classifies the server being slow to start", () => {
    for (const code of ["SERVICE_WAKING", "SERVICE_UNAVAILABLE"]) {
      const error = new ApiError(503, { error: { code, message: code } });
      expect(isColdStartFailure(error)).toBe(true);
      expect(isCredentialFailure(error)).toBe(false);
    }
  });

  it("classifies every failure that is about the visitor's own input", () => {
    for (const code of [
      "INVALID_CREDENTIALS",
      "ACCOUNT_DISABLED",
      "ACCOUNT_LOCKED",
      "EMAIL_UNAVAILABLE",
      "PASSWORD_TOO_SHORT",
      "PASSWORD_BREACHED",
      "TOO_MANY_ATTEMPTS"
    ]) {
      const error = new ApiError(400, { error: { code, message: code } });
      expect(isCredentialFailure(error)).toBe(true);
      expect(isColdStartFailure(error)).toBe(false);
    }
  });

  // An unclassified code reads as an unexpected error rather than silently
  // becoming "check your password", which is why isCredentialFailure lists
  // its codes instead of being written as "not a cold start".
  it("claims neither for a code nobody has classified", () => {
    const error = new ApiError(500, { error: { code: "INTERNAL_ERROR", message: "boom" } });
    expect(isColdStartFailure(error)).toBe(false);
    expect(isCredentialFailure(error)).toBe(false);
  });
});
