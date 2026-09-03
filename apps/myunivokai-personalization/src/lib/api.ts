import type {
  ApiErrorPayload,
  CreateWorldInput,
  DeleteResult,
  GenerationJob,
  PublishResult,
  ShareWorld,
  World,
  WorldFamily,
  WorldVariant
} from "./types";
import { apiPathPrefixForFamily, gatewayOriginUrl } from "./gateway";
import { ApiError, requestGatewayJson, waitForDelay } from "./gatewayRequest";
import { authorizedGatewayRequest } from "./productAuth";
import {
  ANONYMOUS_IDENTIFIER_HEADER_NAME,
  hasProductSession,
  readOrCreateAnonymousIdentifier
} from "./productSession";

// Re-exported so the transport keeps one import path for the rest of the app
// even though it now lives beside this module rather than inside it.
export { ApiError, requestGatewayJson, type GatewayRequestHooks } from "./gatewayRequest";

// The browser knows one gateway origin. Family prefixes select the public
// gateway contract; the gateway translates those requests into NATS traffic.
const API_PATH_PREFIXES_BY_FAMILY: Record<WorldFamily, string> = {
  universe: apiPathPrefixForFamily("universe"),
  nature: apiPathPrefixForFamily("nature"),
  ocean: apiPathPrefixForFamily("ocean")
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


export const DEFAULT_WORLD_FAMILY: WorldFamily = "universe";

/**
 * Whether a value read back out of sessionStorage names a family this build
 * knows.
 *
 * Derived from API_PATH_PREFIXES_BY_FAMILY rather than written out as a literal
 * comparison. The literal it replaces (`family === "universe" || family ===
 * "nature"`) failed no build when the ocean family was added — a resumed
 * generation would simply be discarded on reload, silently, for the newest
 * family only. Because that record is typed `Record<WorldFamily, string>`, the
 * compiler now refuses to let the two drift.
 */
function isKnownWorldFamily(value: unknown): value is WorldFamily {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(API_PATH_PREFIXES_BY_FAMILY, value);
}

/**
 * One world-family request, with the session attached.
 *
 * Every route reached through here still works with no session at all -
 * anonymous creation is the product's first impression - but a signed-in
 * visitor's create has to arrive carrying their token, or the world it
 * produces belongs to nobody and can never be claimed. The one transparent
 * refresh inside matters for the same reason: a seven-day access token is
 * expired at a fair share of visits, and without the refresh each of those
 * creates would quietly lose its owner.
 */
async function request<T>(family: WorldFamily, path: string, init?: RequestInit): Promise<T> {
  return authorizedGatewayRequest<T>(`${API_PATH_PREFIXES_BY_FAMILY[family]}${path}`, init);
}





/**
 * The anonymous id, sent on a create and on nothing else, and only when there
 * is nobody signed in.
 *
 * Only a CREATE, because it is the only request that decides who a world
 * belongs to. The other mutations are checked against an owner the world
 * already has, and an unowned world is mutable by anyone holding its id
 * anyway.
 *
 * Only when signed OUT, because the gateway drops the header whenever it has a
 * verified account to name instead — exactly one of the two identity fields is
 * ever stored. Sending it anyway would work and would be a value nothing
 * reads.
 *
 * This is also where the id is first minted, by the read-or-create: the first
 * anonymous create is precisely when a visitor first needs one. Minting it on
 * page load instead would give an identifier to somebody who only ever looked.
 */
function anonymousCreateHeaders(): Record<string, string> {
  if (hasProductSession()) {
    return {};
  }
  return { [ANONYMOUS_IDENTIFIER_HEADER_NAME]: readOrCreateAnonymousIdentifier() };
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
      // Deliberately unauthenticated, unlike the world calls above: a job
      // belongs to whoever holds its id, and attaching a session here would
      // turn an expired token into a failed poll on a world that is being
      // generated right now.
      job = await requestGatewayJson<GenerationJob>(
        `/api/jobs/${encodeURIComponent(pendingGeneration.jobId)}`,
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
      headers: anonymousCreateHeaders(),
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

  // Owner-only, and the server decides that: a world nobody has claimed cannot
  // be deleted by anybody, which the gateway answers with WORLD_NOT_CLAIMED
  // rather than pretending the world is not there.
  async deleteWorld(worldId: string, family: WorldFamily = DEFAULT_WORLD_FAMILY): Promise<DeleteResult> {
    return request<DeleteResult>(family, `/worlds/${worldId}/delete`, { method: "POST" });
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
