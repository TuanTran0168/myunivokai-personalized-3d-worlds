"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import { readAmbientSoundPreference, writeAmbientSoundPreference } from "@/lib/ambientSoundPreference";
import type { SceneConfig } from "@/lib/types";
import { createAmbientSoundscapeGraph, type AmbientInstrumentSet, type AmbientSoundscapeGraph } from "./ambientSoundscapeGraph";
import { loadArrangement, type Arrangement } from "./arrangements";
import { loadSampledInstrument } from "./instrumentSamples";

// --- Ambience lifecycle ------------------------------------------------------
//
// Four constraints shape this hook, and each is why a piece of it exists:
//
// 1. A browser refuses to make sound before the visitor has interacted with the
//    page. So the AudioContext is constructed inside the click handler, never in
//    an effect, and a remembered preference arms a one-shot gesture listener
//    instead of starting playback directly.
// 2. The instruments are recorded samples that have to be fetched and decoded,
//    and the notes are a written score that has to be fetched too. All of that
//    is asynchronous, so the graph cannot be built in the same tick the visitor
//    asks for sound; it is built once every asset has landed.
// 3. An AudioContext is a real audio-thread resource. Leaving one open per
//    visited world would keep the device's audio hardware awake, so the context
//    is closed on unmount and suspended whenever the tab is hidden.
// 4. Selecting a variant changes the scene, and the sound has to follow it
//    without a gap. The graph is keyed by the recipe signature: React tears the
//    old graph down and builds the new one, and because the old one fades out
//    over the same window the new one fades in, that is a crossfade.

const FADE_IN_SECONDS = 3;
const FADE_OUT_SECONDS = 1.2;
const GRAPH_RELEASE_MILLISECONDS = FADE_OUT_SECONDS * 1000;

// How long a scene has to hold still before its sound is rebuilt. The world and
// share pages settle instantly and never notice this. The create page reseeds
// its preview on every option the visitor touches, and without a settle window
// each flick would start another crossfade on top of the last one.
const SIGNATURE_SETTLE_MILLISECONDS = 700;

const ACTIVATION_GESTURE_EVENTS = ["pointerdown", "keydown"] as const;

type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function resolveAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const webAudioWindow = window as WebAudioWindow;
  return window.AudioContext ?? webAudioWindow.webkitAudioContext ?? null;
}

export type AmbientSoundscapeController = {
  /** False when the browser has no Web Audio support; the toggle disables. */
  isSupported: boolean;
  isEnabled: boolean;
  /** True between the visitor asking for sound and the instruments arriving. */
  isLoading: boolean;
  toggle: () => void;
};

/**
 * Plays the scene's deterministic ambience, and hands back the state a toggle
 * button needs. Pass `isAvailable: false` for canvases that must stay silent
 * (the gallery, which mounts several at once).
 */
export function useAmbientSoundscape(scene: SceneConfig | undefined, isAvailable: boolean): AmbientSoundscapeController {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const audioContextReference = useRef<AudioContext | null>(null);
  const activeGraphReference = useRef<AmbientSoundscapeGraph | null>(null);

  const recipe = useMemo(() => buildAmbientSoundscapeRecipe(scene), [scene]);
  // The recipe object is rebuilt whenever the scene object identity changes —
  // which a hover does. Only its signature decides whether the audio graph has
  // to be rebuilt, so the graph effect reads the recipe through a ref and
  // depends on the signature alone.
  const recipeSignature = recipe.signature;
  const latestRecipeReference = useRef(recipe);
  latestRecipeReference.current = recipe;

  // Everything that has to be fetched before a note can be played: three
  // instruments and the written score. One key covers all four, so the graph can
  // check in a single comparison that what landed is what the current scene asks
  // for.
  const performanceAssetKey = [
    recipe.performance.pieceId,
    recipe.performance.melody.instrument,
    recipe.performance.harmony.instrument,
    recipe.performance.bass.instrument
  ].join("+");
  const [loadedPerformance, setLoadedPerformance] = useState<{
    assetKey: string;
    instruments: AmbientInstrumentSet;
    arrangement: Arrangement;
  } | null>(null);

  // The signature the graph is actually built from: the live one, once it has
  // stopped changing.
  const [settledSignature, setSettledSignature] = useState(recipeSignature);
  useEffect(() => {
    if (settledSignature === recipeSignature) {
      return;
    }
    const timeoutId = setTimeout(() => setSettledSignature(recipeSignature), SIGNATURE_SETTLE_MILLISECONDS);
    return () => clearTimeout(timeoutId);
  }, [recipeSignature, settledSignature]);

  useEffect(() => {
    setIsSupported(resolveAudioContextConstructor() !== null);
  }, []);

  /**
   * Returns the live context, creating it on first use. MUST be reached from a
   * user gesture: a context created outside one starts suspended, and resuming
   * it needs an activation the page may not have yet.
   */
  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (audioContextReference.current) {
      void audioContextReference.current.resume();
      return audioContextReference.current;
    }
    const AudioContextConstructor = resolveAudioContextConstructor();
    if (!AudioContextConstructor) {
      return null;
    }
    const audioContext = new AudioContextConstructor();
    audioContextReference.current = audioContext;
    void audioContext.resume();
    return audioContext;
  }, []);

  // Deliberately not a functional state update: creating an AudioContext is a
  // side effect, and a state updater is not allowed to have one (React invokes
  // updaters twice in development).
  const toggle = useCallback(() => {
    if (isEnabled) {
      writeAmbientSoundPreference(false);
      setIsEnabled(false);
      return;
    }
    if (!ensureAudioContext()) {
      return;
    }
    writeAmbientSoundPreference(true);
    setIsEnabled(true);
  }, [isEnabled, ensureAudioContext]);

  // Ambience defaults to on, but "on" cannot start playback by itself — the
  // browser requires a gesture first. So arm the next gesture anywhere on the
  // page. On a world page that is the first orbit-drag, which happens within
  // seconds; the toggle shows the real state until then, and a visitor who
  // muted keeps their silence because the mute is stored explicitly.
  useEffect(() => {
    if (!isAvailable || isEnabled || !readAmbientSoundPreference()) {
      return;
    }
    function startFromRememberedPreference() {
      if (ensureAudioContext()) {
        setIsEnabled(true);
      }
    }
    for (const eventName of ACTIVATION_GESTURE_EVENTS) {
      window.addEventListener(eventName, startFromRememberedPreference, { once: true });
    }
    return () => {
      for (const eventName of ACTIVATION_GESTURE_EVENTS) {
        window.removeEventListener(eventName, startFromRememberedPreference);
      }
    };
  }, [isAvailable, isEnabled, ensureAudioContext]);

  // Fetch the score and decode the three instruments this scene calls for.
  // Encoded sample bytes and parsed arrangements are both cached across worlds,
  // so returning to a theme heard before is instant.
  useEffect(() => {
    if (!isEnabled || !isAvailable) {
      return;
    }
    const audioContext = audioContextReference.current;
    if (!audioContext) {
      return;
    }
    const { performance } = latestRecipeReference.current;
    const assetKey = [
      performance.pieceId,
      performance.melody.instrument,
      performance.harmony.instrument,
      performance.bass.instrument
    ].join("+");
    let hasBeenCancelled = false;
    void Promise.all([
      loadSampledInstrument(audioContext, performance.melody.instrument),
      loadSampledInstrument(audioContext, performance.harmony.instrument),
      loadSampledInstrument(audioContext, performance.bass.instrument),
      loadArrangement(performance.pieceId)
    ])
      .then(([melodyInstrument, harmonyInstrument, bassInstrument, arrangement]) => {
        if (!hasBeenCancelled) {
          setLoadedPerformance({
            assetKey,
            instruments: { melody: melodyInstrument, harmony: harmonyInstrument, bass: bassInstrument },
            arrangement
          });
        }
      })
      .catch(() => {
        // A failed fetch leaves the world silent rather than broken.
      });
    return () => {
      hasBeenCancelled = true;
    };
  }, [isEnabled, isAvailable, performanceAssetKey]);

  // The graph itself. Keyed by signature, so a hover re-render leaves the audio
  // untouched and a variant change crossfades into the new world.
  useEffect(() => {
    if (!isEnabled || !isAvailable) {
      return;
    }
    const audioContext = audioContextReference.current;
    const currentRecipe = latestRecipeReference.current;
    const expectedAssetKey = [
      currentRecipe.performance.pieceId,
      currentRecipe.performance.melody.instrument,
      currentRecipe.performance.harmony.instrument,
      currentRecipe.performance.bass.instrument
    ].join("+");
    // The loader effect runs alongside this one; skip until its result matches
    // the scene being played, or the first bars use the previous world's score.
    if (!audioContext || loadedPerformance?.assetKey !== expectedAssetKey) {
      return;
    }
    const graph = createAmbientSoundscapeGraph(
      audioContext,
      currentRecipe,
      FADE_IN_SECONDS,
      loadedPerformance.instruments,
      loadedPerformance.arrangement
    );
    activeGraphReference.current = graph;
    return () => {
      graph.stop(FADE_OUT_SECONDS);
      if (activeGraphReference.current === graph) {
        activeGraphReference.current = null;
      }
    };
  }, [isEnabled, isAvailable, settledSignature, loadedPerformance]);

  // Turning the sound off leaves the context open so re-enabling is instant,
  // but an open running context keeps the device's audio path awake. Suspend it
  // once the fade has finished.
  useEffect(() => {
    if (isEnabled) {
      return;
    }
    const audioContext = audioContextReference.current;
    if (!audioContext) {
      return;
    }
    const timeoutId = setTimeout(() => {
      if (audioContext.state === "running") {
        void audioContext.suspend();
      }
    }, GRAPH_RELEASE_MILLISECONDS);
    return () => clearTimeout(timeoutId);
  }, [isEnabled]);

  // Silence a backgrounded tab. Suspending stops the audio thread entirely,
  // which a gain ramp does not.
  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    function applyVisibilityState() {
      const audioContext = audioContextReference.current;
      if (!audioContext || audioContext.state === "closed") {
        return;
      }
      if (document.hidden) {
        void audioContext.suspend();
        return;
      }
      void audioContext.resume();
    }
    document.addEventListener("visibilitychange", applyVisibilityState);
    return () => document.removeEventListener("visibilitychange", applyVisibilityState);
  }, [isEnabled]);

  // Release the audio hardware when the page goes away. The delay lets the
  // graph's fade finish; closing immediately would cut it into a click.
  useEffect(() => {
    return () => {
      const audioContext = audioContextReference.current;
      audioContextReference.current = null;
      if (!audioContext) {
        return;
      }
      activeGraphReference.current?.stop(FADE_OUT_SECONDS);
      activeGraphReference.current = null;
      setTimeout(() => {
        if (audioContext.state !== "closed") {
          void audioContext.close().catch(() => {
            // Closing races with a browser that already tore the context down.
          });
        }
      }, GRAPH_RELEASE_MILLISECONDS);
    };
  }, []);

  const isLoading = isEnabled && loadedPerformance === null;

  return { isSupported, isEnabled, isLoading, toggle };
}
