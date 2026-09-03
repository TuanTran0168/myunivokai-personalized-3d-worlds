"use client";

import { UniverseCanvas } from "@/components/UniverseCanvas";
import type { SceneConfig } from "@/lib/types";

// A decorative backdrop never needs full resolution; a low dpr cap keeps this
// WebGL context cheap on high-density screens.
const AMBIENT_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 1.25];

type AmbientBackdropProps = {
  /** Already built by the page — this component never derives a scene. */
  scene: SceneConfig;
  /**
   * Offer the scene's procedural ambience. Off by default: a backdrop whose
   * scene is REBUILT as somebody edits a form would restart its soundscape on
   * every rebuild. Only a page whose backdrop stands still should ask for it.
   */
  enableAmbientSound?: boolean;
};

/**
 * A world behind the page, dimmed enough that glass panels stay legible over
 * it.
 *
 * Extracted from the gallery's AmbientWorld when the account page wanted the
 * same thing. What is shared is the presentation — the fixed layer, the dpr
 * cap, the parked entry, the dim and the vignette — and not the choice of
 * scene, which is the one thing the two pages answer differently.
 */
export function AmbientBackdrop({ scene, enableAmbientSound = false }: AmbientBackdropProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <UniverseCanvas
        scene={scene}
        className="h-full"
        devicePixelRatioRange={AMBIENT_DEVICE_PIXEL_RATIO_RANGE}
        enableKeyboardMove={false}
        enableAmbientSound={enableAmbientSound}
        // A backdrop arrives parked. An opening move behind the page's content
        // would pull the eye off the content, which is what the page is for.
        entryMotion="none"
      />
      {/* Dim + vignette so foreground glass panels stay legible over the world. */}
      <div className="absolute inset-0 bg-void/55" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_30%,transparent_45%,rgba(8,8,10,0.72))]" />
    </div>
  );
}
