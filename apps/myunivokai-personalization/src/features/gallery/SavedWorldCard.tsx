"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Loader2, Orbit, Trash2, Trees } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import type { World, WorldFamily } from "@/lib/types";
import { isForestScene, paletteFromScene, pointsOfInterestFromScene, sceneFromVariant, selectedVariant } from "@/lib/scene";
import { worldPagePath } from "@/lib/worldRoutes";
import { recordWorldOpenOrigin } from "@/features/transitions/worldOpenOrigin";

const PALETTE_STRIP_COLOR_COUNT = 3;

/**
 * What this card's one destructive button does, which is not the same thing
 * for a signed-in visitor as for a signed-out one.
 *
 * `delete-world` deletes it on the SERVER, and it is the only honest control
 * for a list the server serves: "remove from gallery" on a server-backed
 * world would drop a cache entry and the world would be back on the next
 * reload. That was a true thing to offer while the list was this browser's
 * own, and stopped being true the moment the gallery started reading
 * /api/me/worlds.
 *
 * `forget-locally` is the old behaviour, and it stays exactly that for the
 * anonymous shelf — those worlds have no owner on the server, so nobody can
 * delete them and this list is the only record of them.
 */
export type SavedWorldCardAction = "delete-world" | "forget-locally";

type SavedWorldCardProps = {
  world: World;
  family: WorldFamily;
  action: SavedWorldCardAction;
  onRemove: (worldIdentifier: string) => void;
};

/**
 * The button's label, which is also the whole of what it promises. "Remove
 * from gallery" on a world the server serves would be a promise this app
 * cannot keep.
 */
function destructiveLabelFor(action: SavedWorldCardAction, isDeleteArmed: boolean): string {
  if (action === "forget-locally") {
    return "Remove from gallery";
  }
  if (isDeleteArmed) {
    return "Confirm deleting this world";
  }
  return "Delete this world";
}

function formatCreatedDate(createdAt?: string): string | null {
  if (!createdAt) {
    return null;
  }
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate.toLocaleDateString();
}

export function SavedWorldCard({ world, family, action, onRemove }: SavedWorldCardProps) {
  const cardReference = useRef<HTMLDivElement>(null);
  // Two clicks rather than a dialog, which is the pattern the world page's own
  // Delete already uses (S8-IDENTITY-009). Disarmed on blur, so a card the
  // visitor moved away from does not sit armed under their cursor.
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const worldVariant = selectedVariant(world);
  const worldScene = sceneFromVariant(worldVariant);
  const scenePalette = paletteFromScene(worldScene);
  const pointOfInterestCount = pointsOfInterestFromScene(worldScene).length;
  const isForestWorld = isForestScene(worldScene);
  const PointOfInterestIcon = isForestWorld ? Trees : Orbit;
  const createdDateLabel = formatCreatedDate(world.createdAt);
  const paletteStripColors = scenePalette.slice(0, PALETTE_STRIP_COLOR_COUNT);

  async function handleDestructiveClick() {
    if (action === "forget-locally") {
      onRemove(world.id);
      return;
    }
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      return;
    }
    setIsDeleteArmed(false);
    setIsDeleting(true);
    try {
      await api.deleteWorld(world.id, family);
      // The card goes only once the SERVER agrees it is gone. Removing it
      // first and calling afterwards would leave a visitor looking at a
      // gallery the server does not share — and a world an unowned-world
      // refusal (WORLD_NOT_CLAIMED) means nobody can delete at all.
      onRemove(world.id);
      toast.success("World deleted.");
    } catch (error) {
      toast.error(apiErrorMessage(error));
      setIsDeleting(false);
    }
  }

  const destructiveButtonLabel = destructiveLabelFor(action, isDeleteArmed);

  return (
    <div
      ref={cardReference}
      className="glass-panel glass-lift glass-rise group relative overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/25"
    >
      <Link
        href={worldPagePath(world.id, family)}
        className="focus-ring block"
        // Where the world is being opened from, handed to the route that opens
        // it. Recorded on the click rather than on hover or on mount because
        // this is the last instant the card is certainly still where the
        // visitor saw it — the grid reflows on removal and on resize.
        onClick={() => {
          const cardBox = cardReference.current?.getBoundingClientRect();
          if (cardBox) {
            recordWorldOpenOrigin(world.id, cardBox);
          }
        }}
      >
        {/* Palette specimen strip — solid swatches, not a gradient bar. */}
        <div className="flex h-2 w-full">
          {paletteStripColors.map((stripColor, stripIndex) => (
            <span key={stripIndex} className="h-full flex-1" style={{ backgroundColor: stripColor }} aria-hidden="true" />
          ))}
        </div>
        <div className="p-5">
          {worldScene.archetype ? (
            <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-brass">
              {worldScene.archetype}
            </p>
          ) : null}
          <h2 className="font-display text-lg font-semibold tracking-normal text-paper">
            {worldScene.sceneName || world.title || (isForestWorld ? "Untitled forest" : "Untitled universe")}
          </h2>
          {world.nickname ? (
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-grey">
              A portrait of {world.nickname}
            </p>
          ) : null}
          {worldScene.quote ? (
            <p className="mt-3 line-clamp-2 text-sm italic leading-6 text-on-surface-variant">
              &ldquo;{worldScene.quote}&rdquo;
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-4 font-mono text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <PointOfInterestIcon className="h-3.5 w-3.5 text-brass" aria-hidden="true" />
              {pointOfInterestCount} {isForestWorld ? "landmarks" : "bodies"}
            </span>
            {createdDateLabel ? <span>{createdDateLabel}</span> : null}
          </div>
        </div>
      </Link>
      <button
        type="button"
        title={destructiveButtonLabel}
        aria-label={destructiveButtonLabel}
        disabled={isDeleting}
        onClick={handleDestructiveClick}
        onBlur={() => setIsDeleteArmed(false)}
        className={`focus-ring absolute right-3 top-4 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border transition disabled:opacity-45 group-hover:opacity-100 ${
          isDeleteArmed
            ? "border-error/60 bg-error-container/80 px-2.5 text-xs font-semibold text-on-surface opacity-100"
            : "w-8 border-hairline bg-black/30 text-on-surface-variant opacity-0 hover:border-error/40 hover:text-on-surface"
        }`}
      >
        {isDeleting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        )}
        {isDeleteArmed ? "Confirm" : null}
      </button>
    </div>
  );
}
