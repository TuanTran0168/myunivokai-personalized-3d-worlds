"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { StatusMessage } from "@/components/StatusMessage";
import { SavedWorldCard } from "@/features/gallery/SavedWorldCard";
import { AmbientWorld } from "@/features/gallery/AmbientWorld";
import { useSavedWorlds } from "@/features/gallery/useSavedWorlds";

export default function GalleryPage() {
  const { savedWorldEntries, isLoading, removeSavedWorld, otherOwnerWorldCount, isSignedIn } = useSavedWorlds();

  const loadedWorldEntries = savedWorldEntries.filter((entry) => entry.world);
  const failedWorldEntries = savedWorldEntries.filter((entry) => !entry.world);

  if (isLoading) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pb-[57px] pt-[57px]">
        <StatusMessage tone="loading">Loading your saved worlds...</StatusMessage>
      </main>
    );
  }

  return (
    <>
      <AmbientWorld savedWorldEntries={savedWorldEntries} />
      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-12 pt-[76px] sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">Saved Worlds</div>
          <h1 className="font-display text-4xl font-semibold tracking-normal text-paper">Your Gallery</h1>
          {/* Two different sentences, because they are two different claims.
              Signed out, this really is "whatever this browser made". Signed
              in, it is the account's own worlds - which is why an account
              created on a browser full of anonymous worlds no longer opens
              onto a gallery of somebody else's. The second sentence still says
              "on this device", because that is still true until the server
              serves the list (S8-IDENTITY-015 and 016). */}
          <p className="mt-2 text-on-surface-variant">
            {isSignedIn
              ? "Worlds saved to your account, from this device. They will follow your account to other devices soon."
              : "Worlds you created on this device, without an account. They live in your browser storage."}
          </p>
        </div>
        <Link
          href="/"
          className="focus-ring btn-gradient inline-flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create new world
        </Link>
      </div>

      {/* The note that stops an empty shelf reading as a loss. A new account
          on a browser with anonymous worlds sees nothing, which is correct and
          alarming; saying where those worlds are costs one sentence.

          Rare since the claim landed (S8-IDENTITY-011): signing in moves the
          anonymous shelf onto the account, so this appears only when the claim
          could not run - the anonymous-id cookie was cleared, or its 180 days
          have passed, while these localStorage entries survived. Those worlds
          are unclaimable for ever, because nobody can prove they made them
          (decision 16), which is why the copy no longer promises anything. */}
      {isSignedIn && otherOwnerWorldCount > 0 ? (
        <div className="mb-6 rounded-xl border border-hairline bg-black/30 px-4 py-3 text-sm text-on-surface-variant">
          {otherOwnerWorldCount === 1
            ? "1 world on this device was created without an account, so it is not part of your account. "
            : `${otherOwnerWorldCount} worlds on this device were created without an account, so they are not part of your account. `}
          Sign out to see them.
        </div>
      ) : null}

      {loadedWorldEntries.length === 0 ? (
        <div className="glass-panel grid place-items-center gap-4 rounded-2xl px-6 py-16 text-center">
          <p className="text-lg font-semibold text-on-surface">No saved worlds yet</p>
          <p className="max-w-md text-sm leading-6 text-on-surface-variant">
            {isSignedIn
              ? "Create a world while signed in and it will appear here automatically."
              : "Create your first personal world and it will appear here automatically."}
          </p>
          <Link
            href="/"
            className="focus-ring btn-gradient inline-flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create world
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loadedWorldEntries.map((entry) => (
            <SavedWorldCard
              key={entry.worldIdentifier}
              world={entry.world!}
              family={entry.family}
              onRemove={removeSavedWorld}
            />
          ))}
        </div>
      )}

      {failedWorldEntries.length > 0 ? (
        <div className="mt-8 grid gap-2">
          {failedWorldEntries.map((entry) => (
            <div
              key={entry.worldIdentifier}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-black/30 px-4 py-3 text-sm text-on-surface-variant"
            >
              <span className="truncate">
                World <span className="font-mono">{entry.worldIdentifier}</span> could not be loaded
                {entry.errorMessage ? `: ${entry.errorMessage}` : "."}
              </span>
              <button
                type="button"
                onClick={() => removeSavedWorld(entry.worldIdentifier)}
                className="focus-ring rounded-md border border-hairline bg-black/30 px-3 py-1.5 text-on-surface hover:border-white/30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      </main>
    </>
  );
}
