"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { mapWithBoundedConcurrency } from "@/lib/concurrency";
import { resolveGalleryOwnerKey } from "@/lib/galleryOwner";
import {
  familiesInOrderOfAppearance,
  MAXIMUM_GALLERY_SERVER_PAGES,
  referencesFromOwnedWorlds,
  resolveGalleryWorldList,
  splitIntoHydrationBatches,
  type SavedWorldSource
} from "@/lib/galleryWorldSources";
import { hasProductSession } from "@/lib/productSession";
import {
  countSavedWorldsForOtherOwners,
  readSavedWorldReferences,
  removeWorldIdentifierFromGallery,
  replaceCachedWorldReferences,
  type SavedWorldReference
} from "@/lib/savedWorlds";
import type { World, WorldFamily } from "@/lib/types";

export type SavedWorldEntry = {
  worldIdentifier: string;
  family: WorldFamily;
  world?: World;
  errorMessage?: string;
};

export type { SavedWorldSource };

// The fallback path fetches per world; 3 in flight stays far below the
// backend's per-IP rate-limit burst, unlike the old unbounded Promise.all
// that 429'd galleries with more than `burst` saved worlds.
const GALLERY_FETCH_CONCURRENCY_LIMIT = 3;
// Mirrors the backend's NOT_FOUND message so a world missing from the batch
// response reads the same as a single-get 404 did.
const WORLD_NOT_FOUND_MESSAGE = "The requested resource was not found.";

/**
 * Every world one account owns, newest first, by walking the server's keyset
 * pages up to a stated ceiling.
 *
 * A page shorter than its limit returns no cursor, so a visitor with fewer
 * than fifty worlds costs exactly one request.
 */
async function loadOwnedWorldReferences(ownerKey: string, signal?: AbortSignal): Promise<SavedWorldReference[]> {
  const references: SavedWorldReference[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAXIMUM_GALLERY_SERVER_PAGES; pageNumber += 1) {
    const page = await api.getOwnedWorlds(cursor, signal);
    references.push(...referencesFromOwnedWorlds(page.worlds, ownerKey));
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return references;
}

// Preferred path: one batch request per world family (each family lives on
// its own backend), split so no request exceeds what the gateway accepts. If a
// batch fails (older backend without the route, transient error), fall back to
// per-id fetches with bounded concurrency — same entries, same order.
async function loadSavedWorldEntriesForFamily(
  family: WorldFamily,
  references: SavedWorldReference[]
): Promise<SavedWorldEntry[]> {
  try {
    const worldsById = new Map<string, World>();
    for (const batch of splitIntoHydrationBatches(references)) {
      const worlds = await api.getWorldsByIds(
        batch.map((reference) => reference.worldIdentifier),
        family
      );
      for (const world of worlds) {
        worldsById.set(world.id, world);
      }
    }
    return references.map((reference) => {
      const world = worldsById.get(reference.worldIdentifier);
      return world
        ? { worldIdentifier: reference.worldIdentifier, family, world }
        : { worldIdentifier: reference.worldIdentifier, family, errorMessage: WORLD_NOT_FOUND_MESSAGE };
    });
  } catch {
    return mapWithBoundedConcurrency(
      references,
      GALLERY_FETCH_CONCURRENCY_LIMIT,
      async (reference): Promise<SavedWorldEntry> => {
        try {
          return {
            worldIdentifier: reference.worldIdentifier,
            family,
            world: await api.getWorld(reference.worldIdentifier, family)
          };
        } catch (error) {
          return { worldIdentifier: reference.worldIdentifier, family, errorMessage: apiErrorMessage(error) };
        }
      }
    );
  }
}

// Loads every family in parallel, then re-assembles the entries in the
// original saved order so the gallery keeps its newest-first layout across
// mixed universe/nature saves.
async function loadSavedWorldEntries(references: SavedWorldReference[]): Promise<SavedWorldEntry[]> {
  const families = familiesInOrderOfAppearance(references);
  const entriesPerFamily = await Promise.all(
    families.map((family) =>
      loadSavedWorldEntriesForFamily(
        family,
        references.filter((reference) => reference.family === family)
      )
    )
  );
  const entriesByIdentifier = new Map(
    entriesPerFamily.flat().map((entry) => [entry.worldIdentifier, entry] as const)
  );
  return references
    .map((reference) => entriesByIdentifier.get(reference.worldIdentifier))
    .filter((entry): entry is SavedWorldEntry => entry !== undefined);
}

/**
 * Which worlds to render, and where the list came from.
 *
 * Signed in, the server answers and its answer REPLACES this owner's cached
 * entries — never merges with them, because an id only the cache remembers is
 * a world its owner deleted (see `replaceCachedWorldReferences`). If the
 * server cannot be reached the cache is rendered and labelled, which is the
 * one case where a signed-in visitor sees `localStorage` at all.
 *
 * Signed out, nothing changes from before this shipped.
 */
export function useSavedWorlds() {
  const [savedWorldEntries, setSavedWorldEntries] = useState<SavedWorldEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // How many worlds this browser holds for somebody else — in practice, the
  // anonymous shelf as seen by a freshly created account. The page says so
  // rather than letting an empty grid read as "my worlds are gone".
  const [otherOwnerWorldCount, setOtherOwnerWorldCount] = useState(0);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [worldSource, setWorldSource] = useState<SavedWorldSource>("browser");

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    resolveGalleryOwnerKey().then(async (ownerKey) => {
      if (!isMounted) {
        return;
      }
      setIsSignedIn(hasProductSession());
      setOtherOwnerWorldCount(countSavedWorldsForOtherOwners(ownerKey));

      // The decision itself lives in lib/galleryWorldSources.ts as a pure
      // function; this supplies its three pieces of IO. That is what makes the
      // signed-in-with-empty-storage case a unit test rather than something
      // somebody has to clear their own browser to check.
      const { references, source } = await resolveGalleryWorldList({
        hasSession: hasProductSession(),
        ownerKey,
        loadFromServer: (accountOwnerKey) => loadOwnedWorldReferences(accountOwnerKey, controller.signal),
        readCache: readSavedWorldReferences,
        writeCache: replaceCachedWorldReferences
      });
      if (!isMounted) {
        return;
      }
      setWorldSource(source);
      if (references.length === 0) {
        setIsLoading(false);
        return;
      }
      const loadedEntries = await loadSavedWorldEntries(references);
      if (!isMounted) {
        return;
      }
      setSavedWorldEntries(loadedEntries);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  /**
   * Drops a world from the list on screen and from the cache.
   *
   * Not a deletion. For a signed-out visitor this is the whole of "remove",
   * and for a signed-in one it is what happens AFTER a successful delete —
   * the card calls the server itself, because only it knows whether the
   * visitor armed the second click.
   */
  function forgetSavedWorld(worldIdentifier: string) {
    removeWorldIdentifierFromGallery(worldIdentifier);
    setSavedWorldEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.worldIdentifier !== worldIdentifier)
    );
  }

  return {
    savedWorldEntries,
    isLoading,
    removeSavedWorld: forgetSavedWorld,
    otherOwnerWorldCount,
    isSignedIn,
    worldSource
  };
}
