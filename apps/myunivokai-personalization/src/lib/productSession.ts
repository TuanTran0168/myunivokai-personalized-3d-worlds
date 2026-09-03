/**
 * The product session's storage: three first-party cookies the client writes
 * itself, plus the account it belongs to.
 *
 * # Read this before assuming any protection
 *
 * **None of these cookies is `httpOnly`, and none of them can be.** A cookie
 * written by `document.cookie` is readable by `document.cookie` — that is what
 * the API is. So the XSS exposure of the session here is *identical* to
 * `localStorage`, and the Content-Security-Policy in `src/middleware.ts` is
 * what does the work `httpOnly` would have done. A later reader who sees the
 * word "cookie" and infers protection would be wrong, which is why this
 * paragraph is at the top of the file rather than buried beside one function.
 *
 * Only a *server* can set an `httpOnly` cookie, and the gateway is a different
 * site from this app, so a server-set cookie would be a third-party cookie:
 * `SameSite=None`, blocked by Safari since 2020 and by Firefox by default.
 * That is the whole reason the product session is a bearer token the client
 * attaches by hand — see §4.1, §4.2 and §4.5 of
 * agent-system/plans/architecture/end-user-identity-and-ownership.md. The
 * switch trigger is recorded there too: if a custom domain is ever attached,
 * this module is what moves to httpOnly cookies.
 *
 * # What a cookie buys over localStorage, given the exposure is the same
 *
 * Expiry becomes the browser's job. `max-age` passes and the value is gone,
 * with no TTL bookkeeping in application code — which matters here because the
 * access token lives 7 days and the refresh token 3 months, and hand-rolled
 * expiry checks are exactly the kind of code that drifts from the server's
 * idea of the same deadline. It also makes the value readable by a Next.js
 * server component on this origin, if the authenticated area is ever
 * server-rendered. `localStorage` never can be.
 *
 * What it costs: a few hundred bytes on every same-origin request, including
 * page navigations that have no use for them.
 */

const PRODUCT_ACCESS_TOKEN_COOKIE_NAME = "myunivokai_access";
const PRODUCT_REFRESH_TOKEN_COOKIE_NAME = "myunivokai_refresh";
const ANONYMOUS_IDENTIFIER_COOKIE_NAME = "myunivokai_anonymous";

const COOKIE_PATH = "/";
const COOKIE_SAME_SITE = "Lax";

/**
 * 180 days, matching §7's anonymous window. It is not tied to either token's
 * lifetime: the anonymous id has to outlive every session, because its whole
 * job is to identify the worlds a visitor made *before* they had an account so
 * that signing up can claim them.
 */
const ANONYMOUS_IDENTIFIER_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/**
 * The account is kept out of the cookies on purpose. It is not a credential,
 * it is display data — an email address and a name for the account menu — and
 * putting it in a cookie would send it on every same-origin request, including
 * every navigation and every asset, to no end. It is also the one part of the
 * session the app can afford to lose: with the tokens intact, `GET /api/me`
 * re-reads it.
 */
const PRODUCT_ACCOUNT_STORAGE_KEY = "myunivokai.productAccount.v1";

export type ProductAccount = {
  accountId: string;
  email: string;
  name?: string;
  createdAt?: string;
};

export type ProductSessionTokens = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

export type ProductSession = ProductSessionTokens & {
  account: ProductAccount;
};

function isBrowserEnvironment(): boolean {
  return typeof document !== "undefined";
}

/**
 * `Secure` is omitted on plain HTTP so local development works at
 * http://localhost:41300, and required everywhere else.
 *
 * Keyed on the actual protocol rather than on `process.env.NODE_ENV`, which is
 * the mistake this avoids: a production build served over HTTP during a
 * container smoke test would set `Secure` and then silently store nothing,
 * producing a login that "succeeds" and leaves the visitor signed out.
 */
function secureAttribute(): string {
  return isBrowserEnvironment() && window.location.protocol === "https:" ? "; Secure" : "";
}

function writeCookie(name: string, value: string, maximumAgeSeconds: number): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  // Non-negative by construction: a negative max-age is how a cookie is
  // deleted, so an already-expired token arriving from the server would
  // otherwise delete the cookie it was meant to set - and the caller would see
  // a successful write.
  const maximumAge = Math.max(0, Math.floor(maximumAgeSeconds));
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maximumAge}; SameSite=${COOKIE_SAME_SITE}${secureAttribute()}`;
}

function readCookie(name: string): string | null {
  if (!isBrowserEnvironment()) {
    return null;
  }
  // Split on "; " rather than parsing with a regular expression built from the
  // name, so a cookie whose name is a suffix of another cannot be matched by
  // accident - `myunivokai_access` and a hypothetical `x_myunivokai_access`.
  for (const rawCookie of document.cookie.split("; ")) {
    const separatorIndex = rawCookie.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    if (rawCookie.slice(0, separatorIndex) === name) {
      return decodeURIComponent(rawCookie.slice(separatorIndex + 1));
    }
  }
  return null;
}

function deleteCookie(name: string): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  document.cookie = `${name}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=${COOKIE_SAME_SITE}${secureAttribute()}`;
}

/**
 * Seconds from now until an ISO-8601 instant the server chose.
 *
 * The server's expiry is the authority, not a lifetime constant duplicated
 * here: the web token TTLs become admin-editable settings in S8-IDENTITY-012,
 * and a client-side copy of "7 days" would then be a second number that has to
 * be kept in step with a value somebody can change in a form.
 */
function secondsUntil(isoInstant: string): number {
  const expiresAtMilliseconds = Date.parse(isoInstant);
  if (!Number.isFinite(expiresAtMilliseconds)) {
    return 0;
  }
  return (expiresAtMilliseconds - Date.now()) / 1000;
}

export function writeProductSession(session: ProductSession): void {
  writeCookie(PRODUCT_ACCESS_TOKEN_COOKIE_NAME, session.accessToken, secondsUntil(session.accessExpiresAt));
  writeCookie(PRODUCT_REFRESH_TOKEN_COOKIE_NAME, session.refreshToken, secondsUntil(session.refreshExpiresAt));
  writeProductAccount(session.account);
}

export function readProductAccessToken(): string | null {
  return readCookie(PRODUCT_ACCESS_TOKEN_COOKIE_NAME);
}

export function readProductRefreshToken(): string | null {
  return readCookie(PRODUCT_REFRESH_TOKEN_COOKIE_NAME);
}

/**
 * Clears the tokens and the stored account, and deliberately NOT the anonymous
 * id.
 *
 * Signing out is not the same act as becoming a different visitor. The
 * anonymous id identifies the worlds this browser made before it had an
 * account, and destroying it on sign-out would make those worlds unclaimable
 * for ever (§7) — with nothing to say so, because nobody can prove they made
 * an anonymous world.
 */
export function clearProductSession(): void {
  deleteCookie(PRODUCT_ACCESS_TOKEN_COOKIE_NAME);
  deleteCookie(PRODUCT_REFRESH_TOKEN_COOKIE_NAME);
  if (isBrowserEnvironment()) {
    try {
      window.localStorage.removeItem(PRODUCT_ACCOUNT_STORAGE_KEY);
    } catch {
      // Storage may be unavailable (private mode, quota). The tokens are gone
      // either way, which is the part that decides whether anybody is signed in.
    }
  }
}

export function writeProductAccount(account: ProductAccount): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    window.localStorage.setItem(PRODUCT_ACCOUNT_STORAGE_KEY, JSON.stringify(account));
  } catch {
    // Best-effort, same as savedWorlds.ts: losing the display copy costs one
    // GET /api/me, never the session.
  }
}

export function readProductAccount(): ProductAccount | null {
  if (!isBrowserEnvironment()) {
    return null;
  }
  try {
    const storedValue = window.localStorage.getItem(PRODUCT_ACCOUNT_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }
    const parsedValue = JSON.parse(storedValue) as Partial<ProductAccount>;
    if (typeof parsedValue.accountId !== "string" || typeof parsedValue.email !== "string") {
      return null;
    }
    return {
      accountId: parsedValue.accountId,
      email: parsedValue.email,
      name: typeof parsedValue.name === "string" ? parsedValue.name : undefined,
      createdAt: typeof parsedValue.createdAt === "string" ? parsedValue.createdAt : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Whether this browser holds anything that could be turned back into a session.
 *
 * Keyed on the REFRESH token, not the access token. With a 7-day access token
 * and a 3-month refresh token, "the access token expired an hour ago" is an
 * ordinary state that a transparent refresh resolves without the visitor
 * noticing — treating it as signed out would sign people out weekly for no
 * reason.
 */
export function hasProductSession(): boolean {
  return readProductRefreshToken() !== null;
}

/**
 * The anonymous id, created on first read and then stable for its whole
 * window.
 *
 * `crypto.randomUUID` rather than anything derived from the browser: this is
 * an identifier for worlds made before an account existed, not a fingerprint,
 * and it must be as forgettable as clearing a cookie.
 */
export function readOrCreateAnonymousIdentifier(): string {
  const existingIdentifier = readCookie(ANONYMOUS_IDENTIFIER_COOKIE_NAME);
  if (existingIdentifier) {
    // Refreshed on every read so an actively-returning visitor never ages out
    // mid-use, which a fixed 180 days from first visit would allow.
    writeCookie(ANONYMOUS_IDENTIFIER_COOKIE_NAME, existingIdentifier, ANONYMOUS_IDENTIFIER_LIFETIME_SECONDS);
    return existingIdentifier;
  }
  const createdIdentifier = crypto.randomUUID();
  writeCookie(ANONYMOUS_IDENTIFIER_COOKIE_NAME, createdIdentifier, ANONYMOUS_IDENTIFIER_LIFETIME_SECONDS);
  return createdIdentifier;
}

export function readAnonymousIdentifier(): string | null {
  return readCookie(ANONYMOUS_IDENTIFIER_COOKIE_NAME);
}

/**
 * Forgets the anonymous id, which happens exactly once in this app's life: the
 * moment a claim has succeeded.
 *
 * Not on sign-out — `clearProductSession` says why it deliberately leaves this
 * cookie alone. Here it is right, and it is the last step rather than the
 * first: once the server has moved those worlds to an account, this value is a
 * bearer credential that unlocks nothing, sitting in a JS-readable cookie for
 * another 180 days.
 *
 * The next anonymous create mints a fresh one, which is what should happen —
 * worlds made after signing out belong to a different, later anonymous
 * visitor as far as any future claim is concerned.
 */
export function clearAnonymousIdentifier(): void {
  deleteCookie(ANONYMOUS_IDENTIFIER_COOKIE_NAME);
}

/**
 * Exported for the tests and for the CSP's own documentation. Cookie NAMES are
 * not secrets and are part of this app's contract with itself; hard-coding one
 * in a second place is how the writer and the reader drift apart.
 */
/**
 * The header the anonymous id travels in, named here because this module owns
 * the value: its cookie, its 180-day window, and its one deletion.
 *
 * It must also appear in the gateway's product CORS `AllowedHeaders`, or the
 * browser refuses the preflight and every request carrying it fails before it
 * is sent — with no server-side error at all, because the request the gateway
 * would have answered never arrives.
 */
export const ANONYMOUS_IDENTIFIER_HEADER_NAME = "X-Anonymous-Id";

export const PRODUCT_SESSION_COOKIE_NAMES = {
  accessToken: PRODUCT_ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: PRODUCT_REFRESH_TOKEN_COOKIE_NAME,
  anonymousIdentifier: ANONYMOUS_IDENTIFIER_COOKIE_NAME
} as const;
