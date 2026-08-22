import type { WorldFamily } from "./types";

const SAVED_WORLD_IDENTIFIERS_STORAGE_KEY = "myunivokai.savedWorldIds";

const DEFAULT_SAVED_WORLD_FAMILY: WorldFamily = "universe";

/**
 * Every family a stored gallery entry may name.
 *
 * Written as a record rather than an array literal so the compiler forces it to
 * stay complete. As a `WorldFamily[]` it was `["universe", "nature"]`, and
 * adding a third family compiled cleanly while silently dropping every world of
 * that family out of the visitor's gallery on reload — the same class of
 * failure as the pending-generation check in lib/api.ts.
 */
const KNOWN_WORLD_FAMILY_FLAGS: Record<WorldFamily, true> = {
  universe: true,
  nature: true,
  ocean: true
};
const KNOWN_WORLD_FAMILIES = Object.keys(KNOWN_WORLD_FAMILY_FLAGS) as WorldFamily[];

/**
 * One gallery entry: which world, on which backend. Entries were plain id
 * strings before the nature family existed, so the reader accepts both shapes
 * (a bare string means a universe world) and the writer always stores the
 * object shape.
 */
export type SavedWorldReference = {
  worldIdentifier: string;
  family: WorldFamily;
};

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

function parseSavedWorldReference(rawEntry: unknown): SavedWorldReference | null {
  if (typeof rawEntry === "string" && rawEntry.length > 0) {
    return { worldIdentifier: rawEntry, family: DEFAULT_SAVED_WORLD_FAMILY };
  }
  if (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) {
    const candidate = rawEntry as { worldIdentifier?: unknown; family?: unknown };
    if (typeof candidate.worldIdentifier !== "string" || candidate.worldIdentifier.length === 0) {
      return null;
    }
    const family = KNOWN_WORLD_FAMILIES.includes(candidate.family as WorldFamily)
      ? (candidate.family as WorldFamily)
      : DEFAULT_SAVED_WORLD_FAMILY;
    return { worldIdentifier: candidate.worldIdentifier, family };
  }
  return null;
}

export function readSavedWorldReferences(): SavedWorldReference[] {
  if (!isBrowserEnvironment()) {
    return [];
  }
  try {
    const storedValue = window.localStorage.getItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }
    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue
      .map(parseSavedWorldReference)
      .filter((reference): reference is SavedWorldReference => reference !== null);
  } catch {
    return [];
  }
}

function writeSavedWorldReferences(references: SavedWorldReference[]): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY, JSON.stringify(references));
  } catch {
    // Storage may be unavailable (private mode, quota). Gallery is best-effort.
  }
}

export function addWorldIdentifierToGallery(
  worldIdentifier: string,
  family: WorldFamily = DEFAULT_SAVED_WORLD_FAMILY
): void {
  if (!worldIdentifier) {
    return;
  }
  const savedReferences = readSavedWorldReferences();
  if (savedReferences.some((reference) => reference.worldIdentifier === worldIdentifier)) {
    return;
  }
  writeSavedWorldReferences([{ worldIdentifier, family }, ...savedReferences]);
}

export function removeWorldIdentifierFromGallery(worldIdentifier: string): void {
  const savedReferences = readSavedWorldReferences();
  writeSavedWorldReferences(savedReferences.filter((reference) => reference.worldIdentifier !== worldIdentifier));
}
