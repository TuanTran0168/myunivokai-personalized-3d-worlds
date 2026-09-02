import type {
  ApiErrorPayload,
  CreateWorldInput,
  GenerationJob,
  PublishResult,
  ShareWorld,
  World,
  WorldFamily,
  WorldVariant
} from "./types";
import { apiBaseUrlForFamily, gatewayOriginUrl } from "./gateway";

// The browser knows one gateway origin. Family prefixes select the public
// gateway contract; the gateway translates those requests into NATS traffic.
const API_BASE_URLS_BY_FAMILY: Record<WorldFamily, string> = {
  universe: apiBaseUrlForFamily("universe"),
  nature: apiBaseUrlForFamily("nature"),
  ocean: apiBaseUrlForFamily("ocean")
};

const PENDING_GENERATION_STORAGE_KEY = "myunivokai:pending-generation:v1";
const GENERATION_POLL_INITIAL_DELAY_MILLISECONDS = 500;
const GENERATION_POLL_MAXIMUM_DELAY_MILLISECONDS = 2500;
const GENERATION_POLL_DEADLINE_MILLISECONDS = 120_000;
const GENERATION_POLL_BACKOFF_MULTIPLIER = 1.5;

type PendingGeneration = {
  jobId: string;
  family: WorldFamily;
  startedAtMilliseconds: number;
};

export type GenerationProgressHandler = (job: GenerationJob) => void;

export type GenerationOptions = {
  signal?: AbortSignal;
  onProgress?: GenerationProgressHandler;
};

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

export const DEFAULT_WORLD_FAMILY: WorldFamily = "universe";

/**
 * Whether a value read back out of sessionStorage names a family this build
 * knows.
 *
 * Derived from API_BASE_URLS_BY_FAMILY rather than written out as a literal
 * comparison. The literal it replaces (`family === "universe" || family ===
 * "nature"`) failed no build when the ocean family was added — a resumed
 * generation would simply be discarded on reload, silently, for the newest
 * family only. Because that record is typed `Record<WorldFamily, string>`, the
 * compiler now refuses to let the two drift.
 */
function isKnownWorldFamily(value: unknown): value is WorldFamily {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(API_BASE_URLS_BY_FAMILY, value);
}
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

async function request<T>(family: WorldFamily, path: string, init?: RequestInit): Promise<T> {
  return requestUrl<T>(`${API_BASE_URLS_BY_FAMILY[family]}${path}`, init);
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

function waitForDelay(delayMilliseconds: number, signal?: AbortSignal): Promise<void> {
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

function savePendingGeneration(pendingGeneration: PendingGeneration): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(PENDING_GENERATION_STORAGE_KEY, JSON.stringify(pendingGeneration));
  }
}

function loadPendingGeneration(): PendingGeneration | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storedValue = window.sessionStorage.getItem(PENDING_GENERATION_STORAGE_KEY);
  if (!storedValue) {
    return null;
  }
  try {
    const pendingGeneration = JSON.parse(storedValue) as Partial<PendingGeneration>;
    if (
      typeof pendingGeneration.jobId === "string" &&
      isKnownWorldFamily(pendingGeneration.family) &&
      typeof pendingGeneration.startedAtMilliseconds === "number"
    ) {
      return pendingGeneration as PendingGeneration;
    }
  } catch {
    // Invalid browser state is discarded below and never reaches the API.
  }
  clearPendingGeneration();
  return null;
}

function clearPendingGeneration(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(PENDING_GENERATION_STORAGE_KEY);
  }
}

async function waitForGeneratedWorld(
  pendingGeneration: PendingGeneration,
  options: GenerationOptions = {}
): Promise<World> {
  const deadlineMilliseconds = pendingGeneration.startedAtMilliseconds + GENERATION_POLL_DEADLINE_MILLISECONDS;
  let delayMilliseconds = GENERATION_POLL_INITIAL_DELAY_MILLISECONDS;
  for (;;) {
    if (Date.now() >= deadlineMilliseconds) {
      clearPendingGeneration();
      throw new Error("World generation timed out. Please try again.");
    }
    let job: GenerationJob;
    try {
      job = await requestUrl<GenerationJob>(
        `${gatewayOriginUrl()}/api/jobs/${encodeURIComponent(pendingGeneration.jobId)}`,
        { signal: options.signal }
      );
    } catch (error) {
      // PubAck confirms durable acceptance before dna-service necessarily
      // creates its database projection. That short 404 window is expected.
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      const remainingMilliseconds = deadlineMilliseconds - Date.now();
      await waitForDelay(Math.min(delayMilliseconds, remainingMilliseconds), options.signal);
      delayMilliseconds = Math.min(
        Math.round(delayMilliseconds * GENERATION_POLL_BACKOFF_MULTIPLIER),
        GENERATION_POLL_MAXIMUM_DELAY_MILLISECONDS
      );
      continue;
    }
    options.onProgress?.(job);
    if (job.status === "completed") {
      if (!job.worldId) {
        clearPendingGeneration();
        throw new Error("Generation completed without a world identifier.");
      }
      const world = await api.getWorld(job.worldId, pendingGeneration.family, options.signal);
      clearPendingGeneration();
      return world;
    }
    if (job.status === "failed") {
      clearPendingGeneration();
      throw new ApiError(422, {
        error: {
          code: job.error?.code ?? "GENERATION_FAILED",
          message: job.error?.message ?? "World generation failed.",
          details: job.error?.details
        }
      });
    }
    const remainingMilliseconds = deadlineMilliseconds - Date.now();
    await waitForDelay(Math.min(delayMilliseconds, remainingMilliseconds), options.signal);
    delayMilliseconds = Math.min(
      Math.round(delayMilliseconds * GENERATION_POLL_BACKOFF_MULTIPLIER),
      GENERATION_POLL_MAXIMUM_DELAY_MILLISECONDS
    );
  }
}

function normalizeVariant(raw: any): WorldVariant {
  const sceneConfig = raw.sceneConfig ?? raw.scene_config ?? raw.scene ?? raw.config;
  return {
    id: String(raw.id ?? raw.variantId ?? raw.variant_id ?? ""),
    worldId: raw.worldId ?? raw.world_id,
    name: raw.name,
    title: raw.title,
    seed: raw.seed ?? sceneConfig?.seed,
    sceneConfig,
    selected: Boolean(raw.selected ?? raw.isSelected ?? raw.is_selected),
    createdAt: raw.createdAt ?? raw.created_at
  };
}

function normalizeWorld(raw: any): World {
  const world = raw.world ?? raw.data ?? raw;
  // GET /worlds/{id} returns { world, selectedVariant, variants } with the
  // variant list at the response root; POST /worlds returns { world, variant }.
  const variantListRaw =
    raw.variants ?? world.variants ?? world.worldVariants ?? world.world_variants ?? [];
  const singleVariantRaw = raw.variant ?? raw.selectedVariant ?? raw.selected_variant;
  const variantsRaw =
    Array.isArray(variantListRaw) && variantListRaw.length
      ? variantListRaw
      : singleVariantRaw
        ? [singleVariantRaw]
        : [];
  const selectedVariantIdRaw =
    world.selectedVariantId ?? world.selected_variant_id ?? raw.selectedVariant?.id ?? raw.selected_variant?.id;
  return {
    id: String(world.id ?? world.worldId ?? world.world_id ?? ""),
    nickname: world.nickname,
    title: world.title ?? world.name ?? world.sceneName ?? world.scene_name ?? world.nickname,
    summary: world.summary ?? world.description ?? world.shortNarrative ?? world.short_narrative ?? world.quote,
    status: world.status ?? world.visibility,
    shareSlug: world.shareSlug ?? world.share_slug,
    selectedVariantId: selectedVariantIdRaw,
    variants: variantsRaw.map(normalizeVariant).filter((variant) => variant.id),
    createdAt: world.createdAt ?? world.created_at,
    publishedAt: world.publishedAt ?? world.published_at
  };
}

function normalizeShare(raw: any): ShareWorld {
  const publicWorld = raw.world ?? raw.data ?? raw;
  const variantRaw =
    raw.variant ?? publicWorld.variant ?? publicWorld.selectedVariant ?? publicWorld.selected_variant;
  const variant = variantRaw ? normalizeVariant(variantRaw) : undefined;
  return {
    id: String(publicWorld.id ?? publicWorld.worldId ?? publicWorld.world_id ?? ""),
    nickname: publicWorld.nickname,
    title:
      publicWorld.title ??
      publicWorld.name ??
      publicWorld.sceneName ??
      publicWorld.scene_name ??
      publicWorld.nickname,
    summary:
      publicWorld.summary ??
      publicWorld.description ??
      publicWorld.shortNarrative ??
      publicWorld.short_narrative,
    quote: publicWorld.quote,
    archetype: publicWorld.archetype,
    shareSlug: publicWorld.shareSlug ?? publicWorld.share_slug,
    variant,
    publishedAt: publicWorld.publishedAt ?? publicWorld.published_at
  };
}

// Every function takes the world family last (defaulting to universe) so
// existing universe call sites stay unchanged while forest pages route to
// nature-service with the same request shapes.
export const api = {
  async createWorld(
    input: CreateWorldInput,
    family: WorldFamily = DEFAULT_WORLD_FAMILY,
    options: GenerationOptions = {}
  ): Promise<World> {
    const job = await request<GenerationJob>(family, "/worlds", {
      method: "POST",
      body: JSON.stringify(input),
      signal: options.signal
    });
    if (!job.jobId || job.family !== family || job.status !== "queued") {
      throw new Error("Gateway returned an invalid generation job.");
    }
    options.onProgress?.(job);
    const pendingGeneration = { jobId: job.jobId, family, startedAtMilliseconds: Date.now() };
    savePendingGeneration(pendingGeneration);
    return waitForGeneratedWorld(pendingGeneration, options);
  },

  async resumePendingWorld(options: GenerationOptions = {}): Promise<{ world: World; family: WorldFamily } | null> {
    const pendingGeneration = loadPendingGeneration();
    if (!pendingGeneration) {
      return null;
    }
    const world = await waitForGeneratedWorld(pendingGeneration, options);
    return { world, family: pendingGeneration.family };
  },

  async getWorld(
    worldId: string,
    family: WorldFamily = DEFAULT_WORLD_FAMILY,
    signal?: AbortSignal
  ): Promise<World> {
    return normalizeWorld(await request<unknown>(family, `/worlds/${worldId}`, { signal }));
  },

  // Batch read: one request for the whole gallery instead of one per world.
  // Each returned entry has the same shape as GET /worlds/{id}; ids the
  // backend does not know are simply absent from the result.
  async getWorldsByIds(worldIds: string[], family: WorldFamily = DEFAULT_WORLD_FAMILY): Promise<World[]> {
    if (worldIds.length === 0) {
      return [];
    }
    const payload = await request<{ worlds?: unknown[] }>(
      family,
      `/worlds?ids=${worldIds.map(encodeURIComponent).join(",")}`
    );
    const rawWorlds = Array.isArray(payload.worlds) ? payload.worlds : [];
    return rawWorlds.map(normalizeWorld).filter((world) => world.id);
  },

  async regenerateVariant(worldId: string, family: WorldFamily = DEFAULT_WORLD_FAMILY): Promise<WorldVariant> {
    const payload: any = await request<unknown>(family, `/worlds/${worldId}/variants`, {
      method: "POST",
      body: "{}"
    });
    return normalizeVariant(payload.variant ?? payload.data ?? payload);
  },

  async selectVariant(
    worldId: string,
    variantId: string,
    family: WorldFamily = DEFAULT_WORLD_FAMILY
  ): Promise<WorldVariant> {
    const payload: any = await request<unknown>(family, `/worlds/${worldId}/variants/${variantId}/select`, {
      method: "POST",
      body: "{}"
    });
    return normalizeVariant(payload.variant ?? payload.data ?? payload);
  },

  async publishWorld(worldId: string, family: WorldFamily = DEFAULT_WORLD_FAMILY): Promise<PublishResult> {
    const payload = await request<{ shareSlug?: string; shareUrl?: string; share_slug?: string }>(
      family,
      `/worlds/${worldId}/publish`,
      { method: "POST", body: "{}" }
    );
    return { shareSlug: payload.shareSlug ?? payload.share_slug ?? "", shareUrl: payload.shareUrl ?? "" };
  },

  async getShareWorld(shareSlug: string, family: WorldFamily = DEFAULT_WORLD_FAMILY): Promise<ShareWorld> {
    return normalizeShare(await request<unknown>(family, `/share/worlds/${shareSlug}`));
  }
};

function validationDetailMessages(details: unknown[]): string[] {
  return details
    .map((detail) => {
      if (detail && typeof detail === "object" && "message" in detail) {
        const message = (detail as { message?: unknown }).message;
        return typeof message === "string" ? message : "";
      }
      return "";
    })
    .filter((message) => message.length > 0);
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Surface the backend's field-level validation messages (e.g. "Goal must be
    // 10-220 characters.") instead of the generic "Please check the highlighted
    // fields." so the user can see exactly what to fix.
    const detailMessages = validationDetailMessages(error.details);
    const baseMessage = detailMessages.length > 0 ? detailMessages.join(" ") : error.message;
    return error.requestId ? `${baseMessage} (${error.requestId})` : baseMessage;
  }
  if (error instanceof Error) {
    if (error.message === "Failed to fetch" || error.message.toLowerCase().includes("fetch failed")) {
      return `API Gateway is not reachable (${gatewayOriginUrl()}). Start the local stack, then try Generate again.`;
    }
    return error.message;
  }
  return "Something went wrong";
}
