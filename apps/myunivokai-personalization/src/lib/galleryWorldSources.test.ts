import { describe, expect, it, vi } from "vitest";
import {
  familiesInOrderOfAppearance,
  MAXIMUM_GALLERY_SERVER_PAGES,
  referencesFromOwnedWorlds,
  resolveGalleryWorldList,
  splitIntoHydrationBatches,
  WORLD_HYDRATION_BATCH_SIZE
} from "./galleryWorldSources";
import type { SavedWorldReference } from "./savedWorlds";
import type { OwnedWorldSummary } from "./types";

const ACCOUNT_OWNER_KEY = "account:11111111-1111-1111-1111-111111111111";

function ownedWorld(worldId: string, family: OwnedWorldSummary["family"] = "universe"): OwnedWorldSummary {
  return { worldId, family, createdAt: "2026-09-03T10:00:00Z" };
}

function reference(worldIdentifier: string, family: SavedWorldReference["family"] = "universe"): SavedWorldReference {
  return { worldIdentifier, family, ownerKey: ACCOUNT_OWNER_KEY };
}

describe("resolveGalleryWorldList", () => {
  // The whole point of S8-IDENTITY-016, in the one shape the story names: an
  // account with worlds, and a browser whose storage was just cleared. Before
  // this, the answer was an empty grid.
  it("finds an account's worlds on a device whose storage is empty", async () => {
    const writeCache = vi.fn();
    const list = await resolveGalleryWorldList({
      hasSession: true,
      ownerKey: ACCOUNT_OWNER_KEY,
      loadFromServer: async () => [reference("world-a"), reference("world-b")],
      readCache: () => [],
      writeCache
    });

    expect(list.source).toBe("server");
    expect(list.references.map((entry) => entry.worldIdentifier)).toEqual(["world-a", "world-b"]);
    expect(writeCache).toHaveBeenCalledWith(ACCOUNT_OWNER_KEY, list.references);
  });

  // The correction to section 8, which asks for the two lists to be "merged
  // newest-first with the server list winning on conflict". Winning a conflict
  // decides only ids present in BOTH lists; an id present only in the cache
  // survives a merge, and that id is exactly a world its owner deleted. So the
  // server's answer replaces rather than merges, and this is the test that
  // fails if somebody implements the plan's sentence literally.
  it("does not resurrect a world the server has stopped listing", async () => {
    const list = await resolveGalleryWorldList({
      hasSession: true,
      ownerKey: ACCOUNT_OWNER_KEY,
      loadFromServer: async () => [reference("still-here")],
      readCache: () => [reference("still-here"), reference("deleted-on-another-device")],
      writeCache: () => {}
    });

    expect(list.references.map((entry) => entry.worldIdentifier)).toEqual(["still-here"]);
  });

  it("falls back to the cache and says so when the server cannot be reached", async () => {
    const writeCache = vi.fn();
    const list = await resolveGalleryWorldList({
      hasSession: true,
      ownerKey: ACCOUNT_OWNER_KEY,
      loadFromServer: async () => {
        throw new Error("gateway unreachable");
      },
      readCache: () => [reference("world-a")],
      writeCache
    });

    expect(list.source).toBe("cache");
    expect(list.references.map((entry) => entry.worldIdentifier)).toEqual(["world-a"]);
    // A failed read must not overwrite the cache with nothing, which would
    // turn one bad request into a permanently empty gallery.
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("leaves a signed-out visitor exactly where they were", async () => {
    const loadFromServer = vi.fn();
    const list = await resolveGalleryWorldList({
      hasSession: false,
      ownerKey: "anonymous",
      loadFromServer,
      readCache: () => [reference("world-a")],
      writeCache: () => {}
    });

    expect(list.source).toBe("browser");
    expect(list.references).toHaveLength(1);
    expect(loadFromServer).not.toHaveBeenCalled();
  });

  // A live session whose account could not be resolved. Showing nothing is the
  // decided answer (galleryOwner.ts): guessing wrong here shows one person's
  // worlds to whoever is signed in.
  it("asks the server for nothing when it does not know whose gallery this is", async () => {
    const loadFromServer = vi.fn();
    const list = await resolveGalleryWorldList({
      hasSession: true,
      ownerKey: null,
      loadFromServer,
      readCache: (ownerKey) => (ownerKey === null ? [] : [reference("world-a")]),
      writeCache: () => {}
    });

    expect(list.references).toHaveLength(0);
    expect(loadFromServer).not.toHaveBeenCalled();
  });
});

describe("referencesFromOwnedWorlds", () => {
  it("stamps the owner on every row, because the server list is by definition theirs", () => {
    const references = referencesFromOwnedWorlds([ownedWorld("world-a"), ownedWorld("world-b", "ocean")], ACCOUNT_OWNER_KEY);
    expect(references).toEqual([
      { worldIdentifier: "world-a", family: "universe", ownerKey: ACCOUNT_OWNER_KEY },
      { worldIdentifier: "world-b", family: "ocean", ownerKey: ACCOUNT_OWNER_KEY }
    ]);
  });

  it("drops a row with no world identifier rather than rendering a card that loads nothing", () => {
    const references = referencesFromOwnedWorlds(
      [ownedWorld("world-a"), { worldId: "", family: "universe", createdAt: "" }],
      ACCOUNT_OWNER_KEY
    );
    expect(references).toHaveLength(1);
  });
});

describe("splitIntoHydrationBatches", () => {
  // The cap the gateway enforces with a 400. A server list has no accidental
  // ceiling, unlike a list one browser happened to hold, so a visitor with
  // sixty worlds of one family is now a real case.
  it("never asks for more identifiers than the gateway accepts", () => {
    const identifiers = Array.from({ length: 120 }, (_unused, index) => `world-${index}`);
    const batches = splitIntoHydrationBatches(identifiers);

    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(WORLD_HYDRATION_BATCH_SIZE);
    }
    expect(batches.flat()).toEqual(identifiers);
  });

  it("makes one request for a list that fits in one", () => {
    expect(splitIntoHydrationBatches(["world-a", "world-b"])).toEqual([["world-a", "world-b"]]);
  });

  it("makes no request at all for an empty list", () => {
    expect(splitIntoHydrationBatches([])).toEqual([]);
  });

  // A batch size of zero would loop for ever. One oversized request the server
  // refuses out loud is a better way to report a caller's bug than a hung
  // gallery.
  it("does not hang on a nonsensical batch size", () => {
    expect(splitIntoHydrationBatches(["world-a", "world-b"], 0)).toEqual([["world-a", "world-b"]]);
  });
});

describe("familiesInOrderOfAppearance", () => {
  it("asks only the backends that actually hold something", () => {
    const families = familiesInOrderOfAppearance([
      reference("world-a", "ocean"),
      reference("world-b", "ocean"),
      reference("world-c", "nature")
    ]);
    expect(families).toEqual(["ocean", "nature"]);
  });

  it("returns nothing for an empty list", () => {
    expect(familiesInOrderOfAppearance([])).toEqual([]);
  });
});

describe("the server page walk", () => {
  // The ceiling is stated rather than discovered. Four pages of fifty is two
  // hundred worlds; a visitor past that sees the newest two hundred, which is
  // a decision and not an accident.
  it("has a named ceiling that is well past any real account", () => {
    expect(MAXIMUM_GALLERY_SERVER_PAGES).toBeGreaterThan(1);
    expect(MAXIMUM_GALLERY_SERVER_PAGES * WORLD_HYDRATION_BATCH_SIZE).toBeGreaterThanOrEqual(200);
  });
});
