"use client";

import { Loader2, Volume2, VolumeX } from "lucide-react";

// The one control for world ambience. It sits in the canvas overlay rather than
// the HUD islands because the sound belongs to the scene, not to the page
// around it — the share page has no HUD to put it in.

const PLAY_ACCESSIBLE_LABEL = "Play world ambience";
const MUTE_ACCESSIBLE_LABEL = "Mute world ambience";
const UNSUPPORTED_ACCESSIBLE_LABEL = "World ambience is not available in this browser";
const LOADING_ACCESSIBLE_LABEL = "Loading the world's music";

type AmbientSoundToggleProps = {
  isEnabled: boolean;
  isSupported: boolean;
  /** The score and the recorded instruments are fetched, so there is a real wait. */
  isLoading: boolean;
  onToggle: () => void;
};

function accessibleLabel(isSupported: boolean, isEnabled: boolean, isLoading: boolean): string {
  if (!isSupported) {
    return UNSUPPORTED_ACCESSIBLE_LABEL;
  }
  if (isLoading) {
    return LOADING_ACCESSIBLE_LABEL;
  }
  return isEnabled ? MUTE_ACCESSIBLE_LABEL : PLAY_ACCESSIBLE_LABEL;
}

export function AmbientSoundToggle({ isEnabled, isSupported, isLoading, onToggle }: AmbientSoundToggleProps) {
  const label = accessibleLabel(isSupported, isEnabled, isLoading);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!isSupported}
      aria-pressed={isEnabled}
      aria-label={label}
      title={label}
      className="focus-ring pointer-events-auto rounded-md border border-white/10 bg-black/50 p-2 text-white/60 backdrop-blur transition-colors hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-white/60"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : isEnabled ? (
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      ) : (
        <VolumeX className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
