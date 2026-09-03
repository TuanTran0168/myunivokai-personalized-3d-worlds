import type { ApiErrorPayload } from "./types";
import { gatewayOriginUrl } from "./gateway";

/**
 * The gateway transport, with nothing about worlds or identity in it.
 *
 * It lives in its own module for one structural reason: `api.ts` needs the
 * session (a world has an owner now) and `productAuth.ts` needs the transport,
 * so leaving the transport in `api.ts` would make the two import each other.
 * One retry loop, imported by both, is what keeps a single set of retry
 * budgets for the whole product surface.
 */

/**
 * Hooks a caller can attach to one gateway request.
 *
 * `onServiceWaking` fires each time a SERVICE_WAKING reply is about to be
 * waited on, and it exists because the retry loop below is otherwise silent:
 * it turns a 20-60 second cold start into a request that simply takes a long
 * time, which is fine for a background poll and wrong for a form somebody is
 * sitting in front of. S8-IDENTITY-005 needs the sign-in button to be able to
 * say what is happening, and the only place that knows is the loop that
 * decided to wait.
 *
 * `attemptNumber` starts at 1 so a UI can distinguish the first wait, which
 * every cold start produces, from a fourth, which means the wake is not
 * working.
 */
export type GatewayRequestHooks = {
  onServiceWaking?: (attemptNumber: number) => void;
};

export class ApiError extends Error {
  code: string;
  details: unknown[];
  requestId?: string;
  status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    const error = payload.error ?? {};
    super(error.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code || "request_failed";
    this.details = error.details || [];
    this.requestId = error.requestId;
  }
}

// Idempotent GETs retry once on 429: the backend's token bucket refills within
// about a second (and says so via Retry-After), so a transient burst should not
// become a permanent error tile. Mutating requests are never retried — a
// duplicate POST could create a second world/variant.
const MAXIMUM_GET_RETRIES_ON_RATE_LIMIT = 1;
const DEFAULT_RATE_LIMIT_RETRY_MILLISECONDS = 1000;

// A service that was asleep answers instantly with SERVICE_WAKING while the
// gateway starts it in the background. That needs a far larger budget than the
// rate-limit retry: a container cold start runs tens of seconds, and unlike a
// 429 there is nothing the caller can do except wait for it.
//
// Retried for every method, not only GET. SERVICE_WAKING is produced by one
// condition — the broker reporting that no subscriber existed — which means
// the request provably never reached a service, so a repeat cannot create a
// second world or variant. That is a stronger guarantee than the 429 above,
// whose conservative GET-only rule is left as it was.
const MAXIMUM_RETRIES_ON_SERVICE_WAKING = 6;
const DEFAULT_SERVICE_WAKING_RETRY_MILLISECONDS = 10_000;
const SERVICE_WAKING_ERROR_CODE = "SERVICE_WAKING";

function retryDelayMilliseconds(response: Response, fallbackMilliseconds: number): number {
  const retryAfterSeconds = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return fallbackMilliseconds;
}

function isServiceWaking(status: number, payload: ApiErrorPayload): boolean {
  return status === 503 && payload?.error?.code === SERVICE_WAKING_ERROR_CODE;
}

async function requestUrl<T>(url: string, init?: RequestInit, hooks?: GatewayRequestHooks): Promise<T> {
  const isIdempotentGet = !init?.method || init.method.toUpperCase() === "GET";
  let rateLimitRetriesLeft = isIdempotentGet ? MAXIMUM_GET_RETRIES_ON_RATE_LIMIT : 0;
  let serviceWakingRetriesLeft = MAXIMUM_RETRIES_ON_SERVICE_WAKING;
  let serviceWakingAttempts = 0;

  for (;;) {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });

    if (response.status === 429 && rateLimitRetriesLeft > 0) {
      rateLimitRetriesLeft -= 1;
      await waitForDelay(
        retryDelayMilliseconds(response, DEFAULT_RATE_LIMIT_RETRY_MILLISECONDS),
        init?.signal ?? undefined
      );
      continue;
    }

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    // Checked against the body, not the status: 503 also carries
    // SERVICE_UNAVAILABLE, which means a real fault that retrying will not fix.
    if (isServiceWaking(response.status, payload) && serviceWakingRetriesLeft > 0) {
      serviceWakingRetriesLeft -= 1;
      serviceWakingAttempts += 1;
      hooks?.onServiceWaking?.(serviceWakingAttempts);
      await waitForDelay(
        retryDelayMilliseconds(response, DEFAULT_SERVICE_WAKING_RETRY_MILLISECONDS),
        init?.signal ?? undefined
      );
      continue;
    }

    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }

    return payload as T;
  }
}

/**
 * One gateway request, at a path this module does not own.
 *
 * Exported so the identity calls in ./productAuth reuse this loop rather than
 * writing a second one. That reuse is the whole of S8-IDENTITY-005's first
 * task: `auth-service` is cold at nearly every sign-in, and the
 * SERVICE_WAKING retry behaviour that already carries the create flow through
 * a cold start is exactly what the sign-in form needs. A second
 * implementation would be a second set of retry budgets to keep in step.
 */
export async function requestGatewayJson<T>(
  path: string,
  init?: RequestInit,
  hooks?: GatewayRequestHooks
): Promise<T> {
  return requestUrl<T>(`${gatewayOriginUrl()}${path}`, init, hooks);
}

// Exported because the generation poll in api.ts backs off with the same
// helper the retry loops here do; two implementations of "wait, unless the
// caller aborted" is one too many.
export function waitForDelay(delayMilliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const handleAbort = () => {
      clearTimeout(timeoutIdentifier);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const timeoutIdentifier = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMilliseconds);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
