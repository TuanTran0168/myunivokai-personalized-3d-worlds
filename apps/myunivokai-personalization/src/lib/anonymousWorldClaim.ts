import { claimAnonymousWorlds } from "./productAuth";
import { accountOwnerKey, moveAnonymousWorldsToOwner } from "./savedWorlds";
import type { GatewayRequestHooks } from "./gatewayRequest";

/**
 * The claim, both halves of it, in the one order they can safely happen in.
 *
 * It lives in its own module for the reason `galleryOwner.ts` does: the claim
 * is a network call AND a `localStorage` rewrite, and `savedWorlds.ts` is pure
 * storage with no network in it. Putting the fetch there, or the gallery shelf
 * in `productAuth.ts`, would be the first exception in either.
 *
 * # Why both halves are needed
 *
 * The server half moves `owner_account_id` in up to four databases. The local
 * half moves this browser's gallery entries from the anonymous shelf to the
 * account's. Without the second, the first is invisible: the gallery renders
 * from `localStorage` filtered by owner, so a visitor who signed up and claimed
 * five worlds would still be looking at an empty grid.
 *
 * # Why the server goes first
 *
 * The anonymous id is the only thing that can ever claim those worlds, and the
 * server is the only place that decides whether it did. Moving the local shelf
 * first would file worlds under an account the databases do not agree owns
 * them, and there would be no way back — `addWorldIdentifierToGallery` refuses
 * to copy an id between shelves precisely because a world id proves nothing.
 */
export type AnonymousWorldClaimResult = {
  /** False when this browser had no anonymous id, so there was nothing to ask for. */
  claimAccepted: boolean;
  /** How many gallery entries moved onto the account's shelf. */
  movedWorldCount: number;
};

export async function claimAnonymousWorldsForAccount(
  accountIdentifier: string,
  hooks?: GatewayRequestHooks
): Promise<AnonymousWorldClaimResult> {
  const claimAccepted = await claimAnonymousWorlds(hooks);
  if (!claimAccepted) {
    return { claimAccepted: false, movedWorldCount: 0 };
  }
  // An empty account id means the session response carried no account, which
  // would make the shelf key `account:` — a shelf shared by every account this
  // browser ever signs into. The server claim has already succeeded and is not
  // undone by this; the gallery shows the worlds on the next load, once
  // `resolveGalleryOwnerKey` has asked /api/me who this is.
  if (!accountIdentifier) {
    return { claimAccepted: true, movedWorldCount: 0 };
  }
  return {
    claimAccepted: true,
    movedWorldCount: moveAnonymousWorldsToOwner(accountOwnerKey(accountIdentifier))
  };
}
