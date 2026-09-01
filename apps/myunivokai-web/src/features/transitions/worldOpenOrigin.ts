import type { GenieRectangle } from "./genieWarp";

/**
 * Where on screen a world was opened FROM, handed across the navigation that
 * follows.
 *
 * The gallery card is gone by the time the world route can draw anything, so
 * the rectangle it occupied has to survive the trip. sessionStorage rather than
 * a module variable: a module variable survives a client-side Next navigation
 * and nothing else, and "the link was opened in a new tab" or "the visitor
 * reloaded" would then silently animate from a rectangle that never existed.
 * Per-tab and transient is exactly the lifetime this has.
 *
 * The rectangle is viewport-relative, which is what `getBoundingClientRect`
 * returns and what the fixed overlay that consumes it needs. It is deliberately
 * NOT translated into document coordinates on the way in.
 */

const WORLD_OPEN_ORIGIN_STORAGE_KEY = "myunivokai.worldOpenOrigin";

/**
 * How long a recorded origin stays usable.
 *
 * It is consumed on read, so this only has to cover the case where the
 * navigation never completed — the visitor pressed back, or the world request
 * failed and they retried minutes later. Animating out of a rectangle the card
 * has long since vacated is worse than not animating at all.
 */
export const WORLD_OPEN_ORIGIN_FRESHNESS_MILLISECONDS = 20_000;

export type WorldOpenOrigin = GenieRectangle & {
  worldIdentifier: string;
  recordedAtEpochMilliseconds: number;
};

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function parseWorldOpenOrigin(rawValue: unknown): WorldOpenOrigin | null {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return null;
  }
  const candidate = rawValue as Record<string, unknown>;
  if (typeof candidate.worldIdentifier !== "string" || candidate.worldIdentifier.length === 0) {
    return null;
  }
  const numericFields = ["left", "top", "width", "height", "recordedAtEpochMilliseconds"] as const;
  for (const field of numericFields) {
    if (typeof candidate[field] !== "number" || !Number.isFinite(candidate[field] as number)) {
      return null;
    }
  }
  return {
    worldIdentifier: candidate.worldIdentifier,
    left: candidate.left as number,
    top: candidate.top as number,
    width: candidate.width as number,
    height: candidate.height as number,
    recordedAtEpochMilliseconds: candidate.recordedAtEpochMilliseconds as number
  };
}

/**
 * Does this origin belong to the world now being opened, and is it recent
 * enough to still describe somewhere the visitor was actually looking?
 */
export function isWorldOpenOriginUsable(
  origin: WorldOpenOrigin | null,
  worldIdentifier: string,
  nowEpochMilliseconds: number
): boolean {
  if (!origin || origin.worldIdentifier !== worldIdentifier) {
    return false;
  }
  const age = nowEpochMilliseconds - origin.recordedAtEpochMilliseconds;
  // A negative age means the clock moved backwards between the two pages. Not
  // impossible (a system time change, a resumed laptop), and no reason to
  // refuse: the origin is certainly not stale.
  return age <= WORLD_OPEN_ORIGIN_FRESHNESS_MILLISECONDS;
}

export function recordWorldOpenOrigin(worldIdentifier: string, rectangle: DOMRect): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  const origin: WorldOpenOrigin = {
    worldIdentifier,
    left: rectangle.left,
    top: rectangle.top,
    width: rectangle.width,
    height: rectangle.height,
    recordedAtEpochMilliseconds: Date.now()
  };
  try {
    window.sessionStorage.setItem(WORLD_OPEN_ORIGIN_STORAGE_KEY, JSON.stringify(origin));
  } catch {
    // Private-mode quota, a disabled store: the reveal falls back to the plain
    // crossfade, which is not worth breaking a navigation over.
  }
}

/**
 * Reads the origin and clears it in the same breath.
 *
 * Consuming on read is what stops one card click from animating every
 * subsequent visit to that world — a variant switch, a back-and-forward, a
 * refresh — out of a rectangle nothing is standing in any more.
 */
export function takeWorldOpenOrigin(worldIdentifier: string): WorldOpenOrigin | null {
  if (!isBrowserEnvironment()) {
    return null;
  }
  let storedValue: string | null = null;
  try {
    storedValue = window.sessionStorage.getItem(WORLD_OPEN_ORIGIN_STORAGE_KEY);
    window.sessionStorage.removeItem(WORLD_OPEN_ORIGIN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!storedValue) {
    return null;
  }
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return null;
  }
  const origin = parseWorldOpenOrigin(parsedValue);
  return isWorldOpenOriginUsable(origin, worldIdentifier, Date.now()) ? origin : null;
}
