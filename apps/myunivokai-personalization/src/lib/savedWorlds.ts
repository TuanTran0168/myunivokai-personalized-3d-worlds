import { hasProductSession, readProductAccount } from "./productSession";
import type { WorldFamily } from "./types";

const SAVED_WORLD_IDENTIFIERS_STORAGE_KEY = "myunivokai.savedWorldIds";
// Deliberately a separate key from the gallery list above, and never
// reordered into it: the gallery grid's own newest-first order is a
// creation-time fact visitors rely on to find things, and must not shuffle
// every time a card is merely opened. This key exists only to answer "which
// world did the visitor last have open", for the gallery's ambient backdrop.
const LAST_VIEWED_WORLD_STORAGE_KEY = "myunivokai.lastViewedWorldId";

const DEFAULT_SAVED_WORLD_FAMILY: WorldFamily = "universe";

/**
 * The shelf a world created without an account belongs to.
 *
 * A CONSTANT rather than the anonymous id from the cookie, and the reason is
 * failure modes rather than taste: this list lives in `localStorage`, which is
 * already per-browser, so one browser has exactly one anonymous shelf and an
 * id distinguishes nothing. What an id would add is a way to lose the shelf —
 * the cookie expires at 180 days and is cleared by anybody clearing cookies,
 * and worlds still sitting in storage would become invisible with no way back.
 *
 * Server-side ownership is a different question, and Phase B answers it with
 * the anonymous id proper (`S8-IDENTITY-011`). This key only decides which
 * worlds THIS browser shows to whoever is currently signed in.
 */
const ANONYMOUS_OWNER_KEY = "anonymous";

const ACCOUNT_OWNER_KEY_PREFIX = "account:";

/**
 * One gallery entry: which world, on which backend, and whose.
 *
 * Entries were plain id strings before the nature family existed, and object
 * entries with no `ownerKey` before accounts existed, so the reader accepts
 * all three shapes and the writer always stores the newest.
 *
 * An entry with NO `ownerKey` is read as anonymous, which is what it is: it
 * was saved before this app could sign anybody in, so nobody owned it. That
 * also means those worlds do not vanish — they are on the anonymous shelf,
 * where a signed-out visitor still finds them.
 */
export type SavedWorldReference = {
  worldIdentifier: string;
  family: WorldFamily;
  ownerKey?: string;
};

export function accountOwnerKey(accountIdentifier: string): string {
  return ACCOUNT_OWNER_KEY_PREFIX + accountIdentifier;
}

export function anonymousOwnerKey(): string {
  return ANONYMOUS_OWNER_KEY;
}

/**
 * Whose worlds this browser should be showing right now.
 *
 * `null` means the question cannot be answered yet: a session exists but the
 * account it belongs to is not in storage. That happens when `localStorage`
 * was evicted while the cookies survived, and the honest response is to go and
 * ask `GET /api/me` rather than to guess — guessing wrong here means showing
 * one person's shelf to whoever is signed in, which is the one outcome worth
 * an extra request to avoid.
 */
export function currentOwnerKey(): string | null {
  if (!hasProductSession()) {
    return ANONYMOUS_OWNER_KEY;
  }
  const account = readProductAccount();
  if (!account?.accountId) {
    return null;
  }
  return accountOwnerKey(account.accountId);
}

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

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

function parseSavedWorldReference(rawEntry: unknown): SavedWorldReference | null {
  if (typeof rawEntry === "string" && rawEntry.length > 0) {
    return { worldIdentifier: rawEntry, family: DEFAULT_SAVED_WORLD_FAMILY, ownerKey: ANONYMOUS_OWNER_KEY };
  }
  if (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) {
    const candidate = rawEntry as { worldIdentifier?: unknown; family?: unknown; ownerKey?: unknown };
    if (typeof candidate.worldIdentifier !== "string" || candidate.worldIdentifier.length === 0) {
      return null;
    }
    const family = KNOWN_WORLD_FAMILIES.includes(candidate.family as WorldFamily)
      ? (candidate.family as WorldFamily)
      : DEFAULT_SAVED_WORLD_FAMILY;
    // A missing owner is the anonymous shelf, not an unowned one. See
    // ANONYMOUS_OWNER_KEY and SavedWorldReference.
    const ownerKey = typeof candidate.ownerKey === "string" && candidate.ownerKey.length > 0
      ? candidate.ownerKey
      : ANONYMOUS_OWNER_KEY;
    return { worldIdentifier: candidate.worldIdentifier, family, ownerKey };
  }
  return null;
}

/**
 * Every entry in storage, whoever owns it. Used by the writer (to dedupe
 * across shelves) and by the counter below; the gallery never renders from it.
 */
function readAllSavedWorldReferences(): SavedWorldReference[] {
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

/**
 * The worlds one owner should see.
 *
 * This is the fix for the confusion an account created on a browser with
 * existing worlds produced: signing up used to show every world the browser
 * had ever made as though the new account had made them. It had, in a sense —
 * they were on the same device — but "worlds on this device" and "my worlds"
 * are different claims, and the moment there is an account to make the second
 * one, mixing them is a lie in whichever direction the reader believes.
 *
 * A null owner returns nothing rather than everything. See currentOwnerKey.
 */
export function readSavedWorldReferences(ownerKey: string | null): SavedWorldReference[] {
  if (ownerKey === null) {
    return [];
  }
  return readAllSavedWorldReferences().filter((reference) => reference.ownerKey === ownerKey);
}

/**
 * How many saved worlds belong to somebody OTHER than this owner.
 *
 * The gallery shows this as a note when a signed-in visitor has an empty shelf
 * and the anonymous one is not: "your worlds are gone" is the conclusion
 * somebody draws otherwise, and it is wrong.
 *
 * Rare since the claim landed (`S8-IDENTITY-011`), because signing in moves
 * the anonymous shelf. What is left is the browser that lost its anonymous-id
 * cookie but kept this list — those worlds cannot be claimed by anybody, so
 * signing out really is how they are reached.
 */
export function countSavedWorldsForOtherOwners(ownerKey: string | null): number {
  if (ownerKey === null) {
    return 0;
  }
  return readAllSavedWorldReferences().filter((reference) => reference.ownerKey !== ownerKey).length;
}

/**
 * Moves this browser's anonymous shelf onto one account's, and answers how
 * many entries moved.
 *
 * The local half of `S8-IDENTITY-011`, and without it the server half is
 * invisible: this gallery renders from `localStorage` filtered by owner, so a
 * claim that moved five worlds in three databases would still show a signed-in
 * visitor an empty grid and a note about worlds on another shelf.
 *
 * Called only AFTER the server has accepted the claim, never before or
 * instead. The reverse order would file worlds under an account the databases
 * do not agree belongs to them, and `addWorldIdentifierToGallery` refuses to
 * copy an id between shelves for exactly that reason: a world id is not proof
 * of anything, which is why the claim is by anonymous id.
 */
export function moveAnonymousWorldsToOwner(ownerKey: string | null): number {
  if (ownerKey === null || ownerKey === ANONYMOUS_OWNER_KEY) {
    return 0;
  }
  const savedReferences = readAllSavedWorldReferences();
  let movedWorldCount = 0;
  const movedReferences = savedReferences.map((reference) => {
    if (reference.ownerKey !== ANONYMOUS_OWNER_KEY) {
      return reference;
    }
    movedWorldCount += 1;
    return { ...reference, ownerKey };
  });
  if (movedWorldCount === 0) {
    return 0;
  }
  writeSavedWorldReferences(movedReferences);
  return movedWorldCount;
}

/**
 * Replaces one owner's shelf with the list the server just answered with, and
 * leaves every other shelf untouched.
 *
 * **This REPLACES rather than merges, and section 8 asks for a merge.** Its
 * words are "the two lists are merged newest-first with the server list
 * winning on conflict", and that rule cannot do what it is meant to: winning a
 * CONFLICT only decides ids present in both lists, and an id present only in
 * the cache survives the merge. That id is exactly a world the server has
 * stopped listing — a world its owner deleted, on this device or another one.
 * So a merge brings deleted worlds back, and brings them back permanently,
 * because the cache is the only thing that still remembers them.
 *
 * Replacing is what makes the stored list a cache rather than a second
 * opinion, which is the demotion the story asked for. The invalidation rule is
 * therefore one sentence: **a successful server read replaces this owner's
 * entries, and nothing else ever does.**
 *
 * The anonymous shelf is never touched by this. Those worlds have no owner
 * anywhere on the server, so no server answer can speak about them, and the
 * one thing that may move them is the claim (`moveAnonymousWorldsToOwner`).
 */
export function replaceCachedWorldReferences(ownerKey: string | null, serverReferences: SavedWorldReference[]): void {
  if (ownerKey === null || ownerKey === ANONYMOUS_OWNER_KEY) {
    return;
  }
  const otherShelves = readAllSavedWorldReferences().filter((reference) => reference.ownerKey !== ownerKey);
  writeSavedWorldReferences([...serverReferences, ...otherShelves]);
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

/**
 * Saves a world to one owner's shelf.
 *
 * The duplicate check spans EVERY shelf, not just this owner's, and that is
 * deliberate. Opening an anonymous world while signed in would otherwise copy
 * it onto the account's shelf — which is claiming a world by its id, and the
 * plan refuses that on purpose: `S8-IDENTITY-011` claims by anonymous id
 * precisely because an id that appears in a URL is not a thing to prove
 * ownership with.
 *
 * A null owner does not write. It means the account is not known yet, and a
 * world filed under a guess is worse than one filed a moment later.
 */
export function addWorldIdentifierToGallery(
  worldIdentifier: string,
  family: WorldFamily = DEFAULT_SAVED_WORLD_FAMILY,
  ownerKey: string | null = ANONYMOUS_OWNER_KEY
): void {
  if (!worldIdentifier || ownerKey === null) {
    return;
  }
  const savedReferences = readAllSavedWorldReferences();
  if (savedReferences.some((reference) => reference.worldIdentifier === worldIdentifier)) {
    return;
  }
  writeSavedWorldReferences([{ worldIdentifier, family, ownerKey }, ...savedReferences]);
}

/**
 * Removes a world from whichever shelf holds it.
 *
 * Not scoped to an owner, and it does not need to be: an id appears on exactly
 * one shelf (see addWorldIdentifierToGallery's cross-shelf dedupe), and the
 * only way to reach this is the remove button on a card the gallery rendered,
 * which only renders the current owner's.
 */
export function removeWorldIdentifierFromGallery(worldIdentifier: string): void {
  const savedReferences = readAllSavedWorldReferences();
  writeSavedWorldReferences(savedReferences.filter((reference) => reference.worldIdentifier !== worldIdentifier));
  // Otherwise a removed-then-re-added-elsewhere world could keep pointing the
  // ambient backdrop at an id the gallery no longer has data for.
  if (isBrowserEnvironment() && readLastViewedWorld()?.worldIdentifier === worldIdentifier) {
    window.localStorage.removeItem(LAST_VIEWED_WORLD_STORAGE_KEY);
  }
}

/**
 * Records the world the visitor just opened on its own detail page. Called
 * unconditionally on every load there (unlike `addWorldIdentifierToGallery`,
 * which is a no-op once a world is already saved) — this is the one place
 * that is allowed to change on a re-view, precisely because nothing reads it
 * for the gallery grid's own ordering.
 */
export function recordLastViewedWorld(worldIdentifier: string, family: WorldFamily): void {
  if (!worldIdentifier) {
    return;
  }
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    window.localStorage.setItem(LAST_VIEWED_WORLD_STORAGE_KEY, JSON.stringify({ worldIdentifier, family }));
  } catch {
    // Storage may be unavailable (private mode, quota). Best-effort, same as the rest of this module.
  }
}

export function readLastViewedWorld(): SavedWorldReference | null {
  if (!isBrowserEnvironment()) {
    return null;
  }
  try {
    const storedValue = window.localStorage.getItem(LAST_VIEWED_WORLD_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }
    return parseSavedWorldReference(JSON.parse(storedValue));
  } catch {
    return null;
  }
}
