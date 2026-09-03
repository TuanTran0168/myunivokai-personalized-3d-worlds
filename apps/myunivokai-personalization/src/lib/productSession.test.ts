import { afterEach, describe, expect, it } from "vitest";
import { installBrowserStorageStub, type BrowserStorageStub } from "./browserStorageStub";
import {
  PRODUCT_SESSION_COOKIE_NAMES,
  clearAnonymousIdentifier,
  clearProductSession,
  hasProductSession,
  readAnonymousIdentifier,
  readOrCreateAnonymousIdentifier,
  readProductAccessToken,
  readProductAccount,
  readProductRefreshToken,
  writeProductSession,
  type ProductSession
} from "./productSession";

let stub: BrowserStorageStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

function isoInstantInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function testSession(): ProductSession {
  return {
    accessToken: "an-access-token",
    accessExpiresAt: isoInstantInDays(7),
    refreshToken: "a-refresh-token",
    refreshExpiresAt: isoInstantInDays(90),
    account: { accountId: "account-1", email: "visitor@example.com", name: "Visitor" }
  };
}

describe("the product session's three cookies", () => {
  it("writes the tokens and reads them back", () => {
    stub = installBrowserStorageStub();

    writeProductSession(testSession());

    expect(readProductAccessToken()).toBe("an-access-token");
    expect(readProductRefreshToken()).toBe("a-refresh-token");
    expect(readProductAccount()?.email).toBe("visitor@example.com");
  });

  it("scopes every cookie to the whole site with SameSite=Lax", () => {
    stub = installBrowserStorageStub();
    const written: string[] = [];
    // The jar keeps only name and value, so the attributes are captured from
    // the raw assignment - which is the only place they exist.
    const documentStub = globalThis.document as unknown as { cookie: string };
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(documentStub), "cookie");
    Object.defineProperty(documentStub, "cookie", {
      configurable: true,
      get: () => descriptor?.get?.call(documentStub) ?? "",
      set: (assignment: string) => {
        written.push(assignment);
        descriptor?.set?.call(documentStub, assignment);
      }
    });

    writeProductSession(testSession());
    readOrCreateAnonymousIdentifier();

    expect(written).toHaveLength(3);
    for (const assignment of written) {
      expect(assignment).toContain("Path=/");
      expect(assignment).toContain("SameSite=Lax");
    }
  });

  it("omits Secure on http and sets it on https", () => {
    stub = installBrowserStorageStub("http:");
    const httpAssignments: string[] = [];
    captureCookieAssignments(httpAssignments);
    writeProductSession(testSession());
    expect(httpAssignments.every((assignment) => !assignment.includes("Secure"))).toBe(true);
    stub.restore();

    stub = installBrowserStorageStub("https:");
    const httpsAssignments: string[] = [];
    captureCookieAssignments(httpsAssignments);
    writeProductSession(testSession());
    expect(httpsAssignments.every((assignment) => assignment.includes("Secure"))).toBe(true);
  });

  // A negative Max-Age is how a cookie is deleted, so an already-expired
  // token arriving from the server must not delete the cookie it was meant to
  // set - the caller would see a successful write and no session.
  it("clamps an already-expired lifetime to zero rather than writing a negative one", () => {
    stub = installBrowserStorageStub();
    const assignments: string[] = [];
    captureCookieAssignments(assignments);

    writeProductSession({ ...testSession(), accessExpiresAt: isoInstantInDays(-1) });

    expect(assignments.some((assignment) => assignment.includes("Max-Age=-"))).toBe(false);
  });

  it("does not match a cookie whose name merely ends with the one being read", () => {
    stub = installBrowserStorageStub();
    document.cookie = `x_${PRODUCT_SESSION_COOKIE_NAMES.accessToken}=somebody-elses-token; Max-Age=60`;

    expect(readProductAccessToken()).toBeNull();
  });
});

describe("signing out", () => {
  it("clears the tokens and the stored account", () => {
    stub = installBrowserStorageStub();
    writeProductSession(testSession());

    clearProductSession();

    expect(readProductAccessToken()).toBeNull();
    expect(readProductRefreshToken()).toBeNull();
    expect(readProductAccount()).toBeNull();
    expect(hasProductSession()).toBe(false);
  });

  // Signing out is not the same act as becoming a different visitor. Losing
  // the anonymous id makes every world made before signing up unclaimable for
  // ever, with nothing to say so.
  it("keeps the anonymous identifier", () => {
    stub = installBrowserStorageStub();
    const anonymousIdentifier = readOrCreateAnonymousIdentifier();
    writeProductSession(testSession());

    clearProductSession();

    expect(readAnonymousIdentifier()).toBe(anonymousIdentifier);
  });
});

describe("the session predicate", () => {
  // With a 7-day access token, "the access token expired an hour ago" is an
  // ordinary state a transparent refresh resolves. Keying on the access token
  // would sign people out weekly for no reason.
  it("reports a session while only the refresh token remains", () => {
    stub = installBrowserStorageStub();
    writeProductSession(testSession());
    document.cookie = `${PRODUCT_SESSION_COOKIE_NAMES.accessToken}=; Max-Age=0`;

    expect(readProductAccessToken()).toBeNull();
    expect(hasProductSession()).toBe(true);
  });
});

describe("the anonymous identifier", () => {
  it("is created once and then stable", () => {
    stub = installBrowserStorageStub();

    const first = readOrCreateAnonymousIdentifier();
    const second = readOrCreateAnonymousIdentifier();

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // The one moment it IS cleared, stated next to the sign-out test that keeps
  // it, because the pair is the whole rule: signing out is not becoming a
  // different visitor, and a successful claim is.
  it("is cleared once a claim has spent it", () => {
    stub = installBrowserStorageStub();
    const spentIdentifier = readOrCreateAnonymousIdentifier();

    clearAnonymousIdentifier();

    expect(readAnonymousIdentifier()).toBeNull();
    // And the next anonymous create mints a DIFFERENT one, rather than
    // resurrecting a value an account already owns the worlds of.
    expect(readOrCreateAnonymousIdentifier()).not.toBe(spentIdentifier);
  });

  it("outlives both token lifetimes", () => {
    stub = installBrowserStorageStub();
    const assignments: string[] = [];
    captureCookieAssignments(assignments);

    readOrCreateAnonymousIdentifier();

    const anonymousAssignment = assignments.find((assignment) =>
      assignment.startsWith(PRODUCT_SESSION_COOKIE_NAMES.anonymousIdentifier)
    );
    const maximumAge = Number(anonymousAssignment?.match(/Max-Age=(\d+)/)?.[1]);
    const ninetyDaysInSeconds = 90 * 24 * 60 * 60;
    expect(maximumAge).toBeGreaterThan(ninetyDaysInSeconds);
  });
});

describe("outside a browser", () => {
  // Every page in this app is server-rendered first. A session read during
  // that render has no document to read, and must answer "signed out" rather
  // than throw - a thrown ReferenceError there is a 500, not a login prompt.
  it("reads nothing and writes nothing rather than throwing", () => {
    expect(readProductAccessToken()).toBeNull();
    expect(readProductAccount()).toBeNull();
    expect(hasProductSession()).toBe(false);
    expect(() => writeProductSession(testSession())).not.toThrow();
    expect(() => clearProductSession()).not.toThrow();
  });
});

/**
 * Records every raw `document.cookie` assignment. The jar keeps only names and
 * values, and the attributes are the thing under test in several cases above,
 * so they have to be captured where they still exist.
 */
function captureCookieAssignments(sink: string[]): void {
  const documentStub = globalThis.document as unknown as { cookie: string };
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(documentStub), "cookie");
  Object.defineProperty(documentStub, "cookie", {
    configurable: true,
    get: () => descriptor?.get?.call(documentStub) ?? "",
    set: (assignment: string) => {
      sink.push(assignment);
      descriptor?.set?.call(documentStub, assignment);
    }
  });
}
