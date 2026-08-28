"use client";

import { useMemo } from "react";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { buildPreviewSceneConfig, sceneFromVariant, selectedVariant } from "@/lib/scene";
import { readLastViewedWorld } from "@/lib/savedWorlds";
import { pickAmbientWorldEntry } from "./ambientWorldSelection";
import type { SavedWorldEntry } from "./useSavedWorlds";

// The fallback backdrop for a visitor with no saved worlds yet (or none that
// loaded) — the only case this input is still used for. Reflective mood keeps
// motion and bloom low so it reads as ambient depth, not a focal scene; a cool
// palette sits quietly under the warm-black chrome.
const AMBIENT_WORLD_INPUT = {
  nickname: "Gallery",
  interests: ["Design", "Art", "Music", "Technology", "Science"],
  traits: ["calm", "curious", "creative"],
  mood: "reflective",
  preferredWorldStyle: "cosmic-galaxy",
  favoriteColors: ["#6FB3C9", "#7C5CF0", "#C9A35B"]
};

// A decorative backdrop never needs full resolution; a low dpr cap keeps this
// second WebGL context cheap on high-density screens.
const AMBIENT_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 1.25];

type AmbientWorldProps = {
  /** Already loaded by the gallery page's own `useSavedWorlds()` — this
   * component never fetches on its own. */
  savedWorldEntries: SavedWorldEntry[];
};

export function AmbientWorld({ savedWorldEntries }: AmbientWorldProps) {
  const scene = useMemo(() => {
    const lastViewed = readLastViewedWorld();
    const chosenEntry = pickAmbientWorldEntry(savedWorldEntries, lastViewed);
    if (chosenEntry?.world) {
      return sceneFromVariant(selectedVariant(chosenEntry.world));
    }
    return buildPreviewSceneConfig(AMBIENT_WORLD_INPUT);
  }, [savedWorldEntries]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <UniverseCanvas
        scene={scene}
        className="h-full"
        devicePixelRatioRange={AMBIENT_DEVICE_PIXEL_RATIO_RANGE}
        enableKeyboardMove={false}
        // Safe here specifically because this is the gallery's only canvas —
        // SavedWorldCard renders no canvas of its own. See the "mounts
        // several canvases at once" comment on UniverseCanvas's
        // enableAmbientSound prop before enabling this anywhere else on the
        // page.
        enableAmbientSound
      />
      {/* Dim + vignette so foreground glass cards stay legible over the world. */}
      <div className="absolute inset-0 bg-void/55" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_30%,transparent_45%,rgba(8,8,10,0.72))]" />
    </div>
  );
}
