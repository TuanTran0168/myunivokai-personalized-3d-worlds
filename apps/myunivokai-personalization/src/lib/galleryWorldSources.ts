import type { OwnedWorldSummary, WorldFamily } from "./types";
import type { SavedWorldReference } from "./savedWorlds";

/**
 * Where the gallery's list of worlds comes from, now that there are two
 * possible answers.
 *
 * Design: section 8 and section 14.1 of
 * agent-system/plans/architecture/end-user-identity-and-ownership.md.
 *
 * **Signed in, the server is the list. Signed out, `localStorage` is.** There
 * is no third state and no blend of the two, which is the one place this
 * module departs from the plan - see `replaceCachedReferences` below for the
 * reason, which is a deleted world coming back.
 */

/**
 * The largest number of world identifiers one `?ids=` request may carry.
 *
 * Mirrors `maximumBatchWorldIdentifiers` in the gateway's world handler, which
 * answers 400 above it. The batching this constant drives is not new
 * behaviour for its own sake: the gallery has always sent one request per
 * family with however many ids that family had, so a visitor with more than
 * fifty worlds of one family got a 400, fell into the per-id fallback path,
 * and fetched them one at a time against a rate limit. That was invisible
 * while the list was capped by what one browser happened to hold; a server
 * list has no such accidental cap.
 */
export const WORLD_HYDRATION_BATCH_SIZE = 50;

/**
 * How many pages of the server list the gallery will follow.
 *
 * The gallery is one grid with no paging control, so the alternative to a
 * bounded walk is showing the first page and silently omitting the rest -
 * which for a visitor with sixty worlds is a gallery that has lost ten of
 * them with nothing saying so. Four pages of fifty is two hundred worlds,
 * which is far past anything this product has produced for one account, and
 * the ceiling is stated rather than discovered: a visitor beyond it sees the
 * newest two hundred.
 *
 * Most visitors cost exactly one request, because a first page shorter than
 * its limit returns no cursor at all.
 */
export const MAXIMUM_GALLERY_SERVER_PAGES = 4;

/**
 * Turns the server's rows into the shape the gallery already renders.
 *
 * The owner key is stamped on here rather than read from the row, because the
 * server list is by definition this account's: the query has no parameter for
 * whose worlds to return other than the token's own subject.
 */
export function referencesFromOwnedWorlds(
  ownedWorlds: OwnedWorldSummary[],
  ownerKey: string
): SavedWorldReference[] {
  return ownedWorlds
    .filter((ownedWorld) => typeof ownedWorld.worldId === "string" && ownedWorld.worldId.length > 0)
    .map((ownedWorld) => ({
      worldIdentifier: ownedWorld.worldId,
      family: ownedWorld.family,
      ownerKey
    }));
}

/**
 * Splits a family's identifiers into requests the gateway will accept.
 *
 * A batch size of zero or less would loop for ever, so it is treated as one
 * batch: a caller passing it has a bug, and hanging the gallery is a worse way
 * to report that than one oversized request the server refuses out loud.
 */
export function splitIntoHydrationBatches<ItemType>(
  items: ItemType[],
  batchSize: number = WORLD_HYDRATION_BATCH_SIZE
): ItemType[][] {
  if (items.length === 0) {
    return [];
  }
  if (batchSize <= 0) {
    return [items];
  }
  const batches: ItemType[][] = [];
  for (let batchStart = 0; batchStart < items.length; batchStart += batchSize) {
    batches.push(items.slice(batchStart, batchStart + batchSize));
  }
  return batches;
}

/**
 * Where the list on screen came from.
 *
 * `server` and `cache` are both a signed-in visitor, and the difference
 * matters to them: a cached list is the last answer the server gave and can be
 * missing a world made on another device, or still showing one deleted there.
 * Saying so costs one sentence and is the alternative to a gallery that is
 * quietly wrong.
 *
 * `browser` is a signed-out visitor, for whom `localStorage` is not a cache at
 * all — it is the only record that exists, because nothing on the server knows
 * whose those worlds are.
 */
export type SavedWorldSource = "server" | "cache" | "browser";

export type GalleryWorldList = {
  references: SavedWorldReference[];
  source: SavedWorldSource;
};

/**
 * The three ways the gallery gets its list, as one function with its IO passed
 * in.
 *
 * Pure so that the case the story calls the whole point — a signed-in visitor
 * on a browser whose storage was just cleared — is a unit test rather than a
 * thing somebody has to clear their own storage to check. This app's vitest
 * setup is `environment: "node"` with no React testing library, so a decision
 * left inside the hook would have been untestable in practice.
 *
 * The order of the branches is the decision:
 *
 *  1. No session, or no usable owner  -> the browser's own shelf.
 *  2. The server answers              -> the server's list, and the cache is
 *                                        REPLACED with it.
 *  3. The server cannot be reached    -> the cache, labelled as one.
 *
 * A null owner key with a live session is the one case worth naming: it means
 * `GET /api/me` could not say who is signed in, and the honest answer is to
 * show nothing rather than to guess. `readCache(null)` returns an empty list
 * for exactly that reason, so this function does not need its own branch for
 * it — but it does need not to reach the server, because there is no owner to
 * file the answer under.
 */
export async function resolveGalleryWorldList(input: {
  hasSession: boolean;
  ownerKey: string | null;
  loadFromServer: (ownerKey: string) => Promise<SavedWorldReference[]>;
  readCache: (ownerKey: string | null) => SavedWorldReference[];
  writeCache: (ownerKey: string, references: SavedWorldReference[]) => void;
}): Promise<GalleryWorldList> {
  if (!input.hasSession || input.ownerKey === null) {
    return { references: input.readCache(input.ownerKey), source: "browser" };
  }
  try {
    const serverReferences = await input.loadFromServer(input.ownerKey);
    input.writeCache(input.ownerKey, serverReferences);
    return { references: serverReferences, source: "server" };
  } catch {
    // The cache is the last answer the server gave, so it is the best
    // available list rather than a different one. The page says it may be out
    // of date; showing an empty gallery to somebody who has worlds would be
    // the worse lie.
    return { references: input.readCache(input.ownerKey), source: "cache" };
  }
}

/**
 * Every family present in a list, in the order it first appears.
 *
 * Derived from the references rather than from the known-families record, so a
 * gallery holding only oceans makes one request and not three.
 */
export function familiesInOrderOfAppearance(references: SavedWorldReference[]): WorldFamily[] {
  const families: WorldFamily[] = [];
  for (const reference of references) {
    if (!families.includes(reference.family)) {
      families.push(reference.family);
    }
  }
  return families;
}
