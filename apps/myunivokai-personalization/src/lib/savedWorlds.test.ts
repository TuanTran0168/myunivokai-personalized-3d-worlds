import { afterEach, describe, expect, it } from "vitest";
import { installBrowserStorageStub, type BrowserStorageStub } from "./browserStorageStub";
import { clearProductSession, writeProductSession, type ProductSession } from "./productSession";
import {
  accountOwnerKey,
  addWorldIdentifierToGallery,
  anonymousOwnerKey,
  countSavedWorldsForOtherOwners,
  currentOwnerKey,
  moveAnonymousWorldsToOwner,
  readSavedWorldReferences,
  removeWorldIdentifierFromGallery
} from "./savedWorlds";

const SAVED_WORLD_IDENTIFIERS_STORAGE_KEY = "myunivokai.savedWorldIds";

let stub: BrowserStorageStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

function isoInstantInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sessionForAccount(accountId: string): ProductSession {
  return {
    accessToken: "an-access-token",
    accessExpiresAt: isoInstantInDays(7),
    refreshToken: "a-refresh-token",
    refreshExpiresAt: isoInstantInDays(90),
    account: { accountId, email: `${accountId}@example.com`, name: "Visitor" }
  };
}

describe("whose worlds the gallery shows", () => {
  // The bug this whole partition exists for: an account created on a browser
  // that already had worlds used to open onto a gallery full of them, as
  // though the new account had made them.
  it("shows a new account none of the worlds made before it existed", () => {
    stub = installBrowserStorageStub();

    addWorldIdentifierToGallery("world-made-anonymously", "universe", anonymousOwnerKey());
    writeProductSession(sessionForAccount("account-1"));

    expect(readSavedWorldReferences(currentOwnerKey())).toEqual([]);
  });

  it("gives those worlds back the moment the account signs out", () => {
    stub = installBrowserStorageStub();

    addWorldIdentifierToGallery("world-made-anonymously", "universe", anonymousOwnerKey());
    writeProductSession(sessionForAccount("account-1"));
    clearProductSession();

    expect(readSavedWorldReferences(currentOwnerKey()).map((reference) => reference.worldIdentifier)).toEqual([
      "world-made-anonymously"
    ]);
  });

  it("keeps two accounts' worlds apart on one browser", () => {
    stub = installBrowserStorageStub();

    addWorldIdentifierToGallery("first-accounts-world", "universe", accountOwnerKey("account-1"));
    addWorldIdentifierToGallery("second-accounts-world", "ocean", accountOwnerKey("account-2"));

    expect(readSavedWorldReferences(accountOwnerKey("account-1")).map((entry) => entry.worldIdentifier)).toEqual([
      "first-accounts-world"
    ]);
    expect(readSavedWorldReferences(accountOwnerKey("account-2")).map((entry) => entry.worldIdentifier)).toEqual([
      "second-accounts-world"
    ]);
  });

  // Read as anonymous rather than as nobody's, which is what they are: they
  // were saved before this app could sign anybody in.
  it("treats a world stored before owners existed as an anonymous one", () => {
    stub = installBrowserStorageStub();
    window.localStorage.setItem(
      SAVED_WORLD_IDENTIFIERS_STORAGE_KEY,
      JSON.stringify([{ worldIdentifier: "legacy-world", family: "nature" }])
    );

    expect(readSavedWorldReferences(anonymousOwnerKey()).map((entry) => entry.worldIdentifier)).toEqual([
      "legacy-world"
    ]);
    expect(readSavedWorldReferences(accountOwnerKey("account-1"))).toEqual([]);
  });

  // The oldest shape of all: a bare id string, from before the nature family.
  it("treats a bare id string as an anonymous universe world", () => {
    stub = installBrowserStorageStub();
    window.localStorage.setItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY, JSON.stringify(["ancient-world"]));

    expect(readSavedWorldReferences(anonymousOwnerKey())).toEqual([
      { worldIdentifier: "ancient-world", family: "universe", ownerKey: "anonymous" }
    ]);
  });

  it("shows nothing rather than somebody else's worlds when it cannot tell who is signed in", () => {
    stub = installBrowserStorageStub();

    addWorldIdentifierToGallery("world-made-anonymously", "universe", anonymousOwnerKey());
    writeProductSession(sessionForAccount("account-1"));
    // Tokens survive, the account copy does not - localStorage evicted while
    // the cookies stayed. currentOwnerKey answers null, and null must not fall
    // back to the anonymous shelf.
    window.localStorage.clear();

    expect(currentOwnerKey()).toBeNull();
    expect(readSavedWorldReferences(currentOwnerKey())).toEqual([]);
  });
});

describe("saving a world to a shelf", () => {
  it("files a world under whoever is signed in when it is made", () => {
    stub = installBrowserStorageStub();
    writeProductSession(sessionForAccount("account-1"));

    addWorldIdentifierToGallery("my-world", "ocean", currentOwnerKey());

    expect(readSavedWorldReferences(accountOwnerKey("account-1"))).toEqual([
      { worldIdentifier: "my-world", family: "ocean", ownerKey: "account:account-1" }
    ]);
  });

  // Claiming a world by opening it is what the plan refuses: S8-IDENTITY-011
  // claims by anonymous id precisely because an id that appears in a URL is
  // not something to prove ownership with.
  it("does not move an anonymous world onto an account's shelf when it is opened while signed in", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("world-made-anonymously", "universe", anonymousOwnerKey());
    writeProductSession(sessionForAccount("account-1"));

    addWorldIdentifierToGallery("world-made-anonymously", "universe", currentOwnerKey());

    expect(readSavedWorldReferences(accountOwnerKey("account-1"))).toEqual([]);
    expect(readSavedWorldReferences(anonymousOwnerKey())).toHaveLength(1);
  });

  it("writes nothing when the owner is unknown, rather than guessing", () => {
    stub = installBrowserStorageStub();

    addWorldIdentifierToGallery("a-world", "universe", null);

    expect(readSavedWorldReferences(anonymousOwnerKey())).toEqual([]);
  });

  it("removes a world from whichever shelf holds it", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("a-world", "universe", accountOwnerKey("account-1"));

    removeWorldIdentifierFromGallery("a-world");

    expect(readSavedWorldReferences(accountOwnerKey("account-1"))).toEqual([]);
  });
});

describe("the count that explains an empty shelf", () => {
  // Without this the gallery's empty state reads as "your worlds are gone".
  it("counts the worlds this browser holds for somebody else", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("first", "universe", anonymousOwnerKey());
    addWorldIdentifierToGallery("second", "nature", anonymousOwnerKey());
    addWorldIdentifierToGallery("mine", "ocean", accountOwnerKey("account-1"));

    expect(countSavedWorldsForOtherOwners(accountOwnerKey("account-1"))).toBe(2);
    expect(countSavedWorldsForOtherOwners(anonymousOwnerKey())).toBe(1);
  });

  it("counts nothing when the owner is unknown, so the note never appears on a guess", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("first", "universe", anonymousOwnerKey());

    expect(countSavedWorldsForOtherOwners(null)).toBe(0);
  });
});

// The local half of the claim (`S8-IDENTITY-011`). Storage only: whether the
// server agreed is anonymousWorldClaim.test.ts's question, and this module has
// no network in it on purpose.
describe("moving the anonymous shelf onto an account", () => {
  it("moves every anonymous entry and leaves the families alone", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("made-first", "universe", anonymousOwnerKey());
    addWorldIdentifierToGallery("made-second", "ocean", anonymousOwnerKey());

    expect(moveAnonymousWorldsToOwner(accountOwnerKey("account-1"))).toBe(2);
    expect(readSavedWorldReferences(accountOwnerKey("account-1"))).toEqual([
      { worldIdentifier: "made-second", family: "ocean", ownerKey: accountOwnerKey("account-1") },
      { worldIdentifier: "made-first", family: "universe", ownerKey: accountOwnerKey("account-1") }
    ]);
    expect(readSavedWorldReferences(anonymousOwnerKey())).toEqual([]);
  });

  // The order is a creation-time fact visitors rely on to find things, and the
  // claim is not a reason for the grid to reshuffle.
  it("keeps the newest-first order it found", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("oldest", "universe", anonymousOwnerKey());
    addWorldIdentifierToGallery("newest", "universe", anonymousOwnerKey());

    moveAnonymousWorldsToOwner(accountOwnerKey("account-1"));

    expect(readSavedWorldReferences(accountOwnerKey("account-1")).map((entry) => entry.worldIdentifier)).toEqual([
      "newest",
      "oldest"
    ]);
  });

  // An entry stored before owners existed has no ownerKey and is read as
  // anonymous, which is what it is. It has to move too, or the visitors with
  // the longest history are the ones the claim does least for.
  it("moves an entry saved before owners existed", () => {
    stub = installBrowserStorageStub();
    window.localStorage.setItem(
      SAVED_WORLD_IDENTIFIERS_STORAGE_KEY,
      JSON.stringify([{ worldIdentifier: "from-before-accounts", family: "nature" }, "an-even-older-string-entry"])
    );

    expect(moveAnonymousWorldsToOwner(accountOwnerKey("account-1"))).toBe(2);
    expect(readSavedWorldReferences(accountOwnerKey("account-1")).map((entry) => entry.worldIdentifier)).toEqual([
      "from-before-accounts",
      "an-even-older-string-entry"
    ]);
  });

  it("leaves another account's shelf untouched", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("somebody-elses", "universe", accountOwnerKey("account-2"));
    addWorldIdentifierToGallery("nobodys-yet", "universe", anonymousOwnerKey());

    expect(moveAnonymousWorldsToOwner(accountOwnerKey("account-1"))).toBe(1);
    expect(readSavedWorldReferences(accountOwnerKey("account-2")).map((entry) => entry.worldIdentifier)).toEqual([
      "somebody-elses"
    ]);
  });

  // Two shapes of "there is nothing to do", both of which must not write.
  // The anonymous key itself is the one worth naming: it would be a move onto
  // the shelf the entries are already on, dressed up as a claim.
  it("writes nothing when there is nothing to move", () => {
    stub = installBrowserStorageStub();
    addWorldIdentifierToGallery("mine-already", "universe", accountOwnerKey("account-1"));
    const storedBefore = window.localStorage.getItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY);

    expect(moveAnonymousWorldsToOwner(accountOwnerKey("account-1"))).toBe(0);
    expect(moveAnonymousWorldsToOwner(anonymousOwnerKey())).toBe(0);
    expect(moveAnonymousWorldsToOwner(null)).toBe(0);
    expect(window.localStorage.getItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY)).toBe(storedBefore);
  });
});
