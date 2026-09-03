"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { mapWithBoundedConcurrency } from "@/lib/concurrency";
import { resolveGalleryOwnerKey } from "@/lib/galleryOwner";
import { hasProductSession } from "@/lib/productSession";
import {
  countSavedWorldsForOtherOwners,
  readSavedWorldReferences,
  removeWorldIdentifierFromGallery,
  type SavedWorldReference
} from "@/lib/savedWorlds";
import type { World, WorldFamily } from "@/lib/types";

export type SavedWorldEntry = {
  worldIdentifier: string;
  family: WorldFamily;
  world?: World;
  errorMessage?: string;
};

// The fallback path fetches per world; 3 in flight stays far below the
// backend's per-IP rate-limit burst, unlike the old unbounded Promise.all
// that 429'd galleries with more than `burst` saved worlds.
const GALLERY_FETCH_CONCURRENCY_LIMIT = 3;
// Mirrors the backend's NOT_FOUND message so a world missing from the batch
// response reads the same as a single-get 404 did.
const WORLD_NOT_FOUND_MESSAGE = "The requested resource was not found.";

// Preferred path: ONE batch request per world family (each family lives on
// its own backend). If a family's batch request fails (older backend without
// the route, transient error), fall back to per-id fetches with bounded
// concurrency — same entries, same order.
async function loadSavedWorldEntriesForFamily(
  family: WorldFamily,
  references: SavedWorldReference[]
): Promise<SavedWorldEntry[]> {
  try {
    const worlds = await api.getWorldsByIds(
      references.map((reference) => reference.worldIdentifier),
      family
    );
    const worldsById = new Map(worlds.map((world) => [world.id, world]));
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
  const families = Array.from(new Set(references.map((reference) => reference.family)));
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

export function useSavedWorlds() {
  const [savedWorldEntries, setSavedWorldEntries] = useState<SavedWorldEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // How many worlds this browser holds for somebody else — in practice, the
  // anonymous shelf as seen by a freshly created account. The page says so
  // rather than letting an empty grid read as "my worlds are gone".
  const [otherOwnerWorldCount, setOtherOwnerWorldCount] = useState(0);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let isMounted = true;

    resolveGalleryOwnerKey().then((ownerKey) => {
      if (!isMounted) {
        return;
      }
      setIsSignedIn(hasProductSession());
      setOtherOwnerWorldCount(countSavedWorldsForOtherOwners(ownerKey));

      const savedWorldReferences = readSavedWorldReferences(ownerKey);
      if (savedWorldReferences.length === 0) {
        setIsLoading(false);
        return;
      }
      loadSavedWorldEntries(savedWorldReferences).then((loadedEntries) => {
        if (!isMounted) {
          return;
        }
        setSavedWorldEntries(loadedEntries);
        setIsLoading(false);
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function removeSavedWorld(worldIdentifier: string) {
    removeWorldIdentifierFromGallery(worldIdentifier);
    setSavedWorldEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.worldIdentifier !== worldIdentifier)
    );
  }

  return { savedWorldEntries, isLoading, removeSavedWorld, otherOwnerWorldCount, isSignedIn };
}
