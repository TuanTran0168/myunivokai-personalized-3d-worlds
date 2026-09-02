import type { SavedWorldReference } from "@/lib/savedWorlds";
import type { SavedWorldEntry } from "./useSavedWorlds";

/**
 * Picks which saved world the gallery's ambient backdrop should render,
 * extracted so the rule can be locked by a test independent of
 * localStorage/network. Pure: no DOM, no fetch.
 *
 * Prefers the visitor's most-recently-viewed world (if it's still in the
 * loaded list); falls back to the most recently saved one so the backdrop is
 * never blank just because nothing has been individually opened yet.
 * Undefined means "nothing usable" — the caller falls back to the fixed demo
 * input, same as an empty gallery always has.
 */
export function pickAmbientWorldEntry(
  entries: SavedWorldEntry[],
  lastViewed: SavedWorldReference | null
): SavedWorldEntry | undefined {
  const loadedEntries = entries.filter((entry) => entry.world);
  if (lastViewed) {
    const lastViewedEntry = loadedEntries.find((entry) => entry.worldIdentifier === lastViewed.worldIdentifier);
    if (lastViewedEntry) {
      return lastViewedEntry;
    }
  }
  return loadedEntries[0];
}
