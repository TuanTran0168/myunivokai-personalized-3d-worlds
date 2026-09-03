import { fetchSignedInAccount } from "./productAuth";
import { writeProductAccount } from "./productSession";
import { accountOwnerKey, currentOwnerKey } from "./savedWorlds";

/**
 * Whose gallery shelf this browser is looking at, asking the server if it
 * cannot answer locally.
 *
 * `currentOwnerKey` answers synchronously and correctly almost always, and
 * returns null in exactly one situation: a live session whose account copy is
 * not in storage. That happens when `localStorage` was evicted while the
 * cookies survived — productSession.ts calls the account copy the one part of
 * the session the app can afford to lose, and this is the call that gets it
 * back.
 *
 * Still null after asking means the session is not usable. Callers show
 * nothing and save nothing rather than falling back to the anonymous shelf:
 * showing a signed-in person somebody else's worlds, or filing their new world
 * under a stranger, are both worse than doing neither.
 *
 * It lives in its own module rather than in savedWorlds.ts because that one is
 * pure storage with no network in it, and rather than in the gallery hook
 * because the create page and the world page need the same answer before they
 * save.
 */
export async function resolveGalleryOwnerKey(): Promise<string | null> {
  const knownOwnerKey = currentOwnerKey();
  if (knownOwnerKey !== null) {
    return knownOwnerKey;
  }
  try {
    const account = await fetchSignedInAccount();
    writeProductAccount(account);
    return account.accountId ? accountOwnerKey(account.accountId) : null;
  } catch {
    return null;
  }
}
