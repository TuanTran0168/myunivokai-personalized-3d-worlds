"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { StatusMessage } from "@/components/StatusMessage";
import { SavedWorldCard } from "@/features/gallery/SavedWorldCard";
import { AmbientWorld } from "@/features/gallery/AmbientWorld";
import { useSavedWorlds } from "@/features/gallery/useSavedWorlds";

export default function GalleryPage() {
  const { savedWorldEntries, isLoading, removeSavedWorld } = useSavedWorlds();

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
          <p className="mt-2 text-on-surface-variant">
            Worlds you created on this device. They live in your browser storage.
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

      {loadedWorldEntries.length === 0 ? (
        <div className="glass-panel grid place-items-center gap-4 rounded-2xl px-6 py-16 text-center">
          <p className="text-lg font-semibold text-on-surface">No saved worlds yet</p>
          <p className="max-w-md text-sm leading-6 text-on-surface-variant">
            Create your first personal world and it will appear here automatically.
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
