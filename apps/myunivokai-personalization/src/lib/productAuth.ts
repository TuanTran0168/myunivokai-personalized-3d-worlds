import { ApiError, requestGatewayJson, type GatewayRequestHooks } from "./gatewayRequest";
import {
  clearProductSession,
  readProductAccessToken,
  readProductRefreshToken,
  writeProductSession,
  type ProductAccount,
  type ProductSession
} from "./productSession";

const SIGN_UP_PATH = "/api/auth/signup";
const SIGN_IN_PATH = "/api/auth/login";
const REFRESH_PATH = "/api/auth/refresh";
const SIGN_OUT_PATH = "/api/auth/logout";
const ACCOUNT_PATH = "/api/me";

/**
 * The gateway's error codes this module has to tell apart, rather than the
 * statuses they arrive with.
 *
 * Keyed on the code and not the status on purpose: 401 covers both a wrong
 * password and a session that needs refreshing, and treating those the same
 * would either sign people out on a typo or retry forever on a bad one.
 */
const UNAUTHENTICATED_ERROR_CODES = new Set(["UNAUTHENTICATED", "SESSION_REVOKED"]);

export type Credentials = {
  email: string;
  password: string;
};

/**
 * Sign-up carries one thing sign-in does not: the name the person wants to be
 * called.
 *
 * A separate type rather than an optional field on Credentials, so LOGIN's
 * request body is unchanged - the gateway decodes the two shapes separately
 * for the same reason, and a login that quietly accepted a name would have a
 * field with no meaning on the one request where somebody might expect it to
 * identify them.
 *
 * It is optional here because it is optional there: an account with no display
 * name is valid, and the account menu falls back to the email address.
 */
export type SignUpDetails = Credentials & {
  name?: string;
};

/**
 * A single in-flight refresh, shared by every caller that discovers an expired
 * access token at the same moment.
 *
 * This is the whole of "N concurrent 401s cause one refresh, not N", and it
 * matters more than it sounds: the refresh token is SINGLE USE with family-wide
 * reuse detection, so two parallel refreshes would present the same token
 * twice, and auth-service would correctly read the second as an intercepted
 * response and revoke the entire family — signing the visitor out for being
 * on a page that made two requests at once.
 *
 * Module scope rather than a class field, because there is exactly one session
 * per browsing context and a second instance would defeat the point.
 */
let refreshInFlight: Promise<ProductSession | null> | null = null;

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && UNAUTHENTICATED_ERROR_CODES.has(error.code);
}

async function postSession(path: string, body: unknown, hooks?: GatewayRequestHooks): Promise<ProductSession> {
  const session = await requestGatewayJson<ProductSession>(
    path,
    { method: "POST", body: JSON.stringify(body) },
    hooks
  );
  writeProductSession(session);
  return session;
}

export async function signUp(details: SignUpDetails, hooks?: GatewayRequestHooks): Promise<ProductSession> {
  return postSession(SIGN_UP_PATH, details, hooks);
}

export async function signIn(credentials: Credentials, hooks?: GatewayRequestHooks): Promise<ProductSession> {
  return postSession(SIGN_IN_PATH, credentials, hooks);
}

/**
 * Signs out, and clears the local session whatever the server said.
 *
 * The order is deliberate: the request goes first so the refresh family is
 * actually revoked server-side, but a failure does not stop the local clear.
 * A visitor who pressed "sign out" and got a network error must not be left
 * holding a working session — and the token they were holding is single-use
 * and revocable, so the worst case of a failed call is a refresh family that
 * expires on its own schedule instead of immediately.
 */
export async function signOut(hooks?: GatewayRequestHooks): Promise<void> {
  const refreshToken = readProductRefreshToken();
  try {
    if (refreshToken) {
      await requestGatewayJson<void>(
        SIGN_OUT_PATH,
        { method: "POST", body: JSON.stringify({ refreshToken }) },
        hooks
      );
    }
  } finally {
    clearProductSession();
  }
}

/**
 * Rotates the session, collapsing concurrent callers onto one request.
 *
 * Returns null rather than throwing when there is nothing to refresh or the
 * refresh is rejected, because every caller does the same thing with that
 * answer: give up and treat the visitor as signed out. A rejected refresh also
 * clears the local session here, so the next request does not present a token
 * the server has already refused.
 */
export async function refreshProductSession(hooks?: GatewayRequestHooks): Promise<ProductSession | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const refreshToken = readProductRefreshToken();
  if (!refreshToken) {
    return null;
  }
  refreshInFlight = postSession(REFRESH_PATH, { refreshToken }, hooks)
    .catch((error: unknown) => {
      // A transport failure is not a rejected session. Clearing on a cold
      // gateway or a dropped connection would sign people out for a network
      // blip; only the server actually refusing the token means the session
      // is over.
      if (error instanceof ApiError) {
        clearProductSession();
        return null;
      }
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * One authenticated gateway request, with the access token attached by hand
 * and one transparent refresh on expiry.
 *
 * "By hand" is the design and not an inconvenience: a token the client puts in
 * a header is never a third-party cookie, whatever box it was kept in, and it
 * is never attached by the browser to a request the app did not make — which
 * is why this whole design has no CSRF surface (§4.3).
 *
 * Exactly one retry. A second would be indistinguishable from a loop against a
 * server that keeps rejecting, and a failed refresh already means the session
 * is over.
 */
export async function authorizedGatewayRequest<T>(
  path: string,
  init?: RequestInit,
  hooks?: GatewayRequestHooks
): Promise<T> {
  const accessToken = readProductAccessToken();
  try {
    return await requestGatewayJson<T>(path, withBearerToken(init, accessToken), hooks);
  } catch (error) {
    if (!isUnauthenticated(error)) {
      throw error;
    }
    const refreshedSession = await refreshProductSession(hooks);
    if (!refreshedSession) {
      throw error;
    }
    return requestGatewayJson<T>(path, withBearerToken(init, refreshedSession.accessToken), hooks);
  }
}

export async function fetchSignedInAccount(hooks?: GatewayRequestHooks): Promise<ProductAccount> {
  return authorizedGatewayRequest<ProductAccount>(ACCOUNT_PATH, undefined, hooks);
}

function withBearerToken(init: RequestInit | undefined, accessToken: string | null): RequestInit {
  if (!accessToken) {
    return init ?? {};
  }
  return {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`
    }
  };
}

/**
 * Whether a failure is the server being slow to start rather than the
 * credentials being wrong.
 *
 * S8-IDENTITY-005's requirement in one function: `auth-service` is on the free
 * tier and, because a 7-day access token means almost no refresh traffic, it
 * is cold at nearly every sign-in. A form that shows "something went wrong"
 * for a cold start is lying, and a form that shows "starting up" for a wrong
 * password is worse — so the two must never share a message.
 *
 * SERVICE_UNAVAILABLE is included alongside SERVICE_WAKING because the client
 * reaches it only after the retry budget is spent or the gateway gave up
 * waking: both mean "the server, not you".
 */
export function isColdStartFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "SERVICE_WAKING" || error.code === "SERVICE_UNAVAILABLE");
}

/**
 * Whether a failure is the visitor's credentials or their own input.
 *
 * The complement of isColdStartFailure, listed explicitly rather than inferred
 * as "not a cold start": a code nobody has classified should read as an
 * unexpected error, not silently become "check your password".
 */
export function isCredentialFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return [
    "INVALID_CREDENTIALS",
    "INVALID_REFRESH_TOKEN",
    "ACCOUNT_DISABLED",
    "ACCOUNT_LOCKED",
    "EMAIL_UNAVAILABLE",
    "PASSWORD_TOO_SHORT",
    "PASSWORD_BREACHED",
    "TOO_MANY_ATTEMPTS",
    "VALIDATION_ERROR"
  ].includes(error.code);
}

/**
 * Reset for tests. The single-flight promise is module state, and a test that
 * left one in flight would change the next test's behaviour.
 */
export function resetRefreshInFlightForTesting(): void {
  refreshInFlight = null;
}
