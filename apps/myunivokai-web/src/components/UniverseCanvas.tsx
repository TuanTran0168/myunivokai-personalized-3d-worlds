"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, AgXToneMapping } from "three";
import type { Vector3 } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, isForestScene, isOceanScene, pointsOfInterestFromScene, CANONICAL_FALLBACK_SEED } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { resolveSceneRenderer, resolveSceneTypeRenderer } from "@/features/scene-renderers/registry";
import { FallbackUniverseRenderer } from "@/features/scene-renderers/fallback/FallbackUniverseRenderer";
import { oceanCameraFraming as oceanCameraFramingFor } from "@/features/scene-renderers/ocean/oceanMath";
import { forestShoreCameraFraming } from "@/features/scene-renderers/forest/forestMath";
import {
  cameraDistanceFromConfig,
  cameraFieldOfViewFromConfig,
  universeCameraPosition
} from "@/features/scene-renderers/universeCameraFraming";
import { AmbientSoundToggle } from "@/components/AmbientSoundToggle";
import { useAmbientSoundscape } from "@/features/audio/useAmbientSoundscape";
import { CameraRig } from "@/features/scene-renderers/shared/CameraRig";
import {
  CAMERA_INTRO_DURATION_SECONDS,
  CAMERA_SETTLE_DURATION_SECONDS
} from "@/features/scene-renderers/shared/cameraIntro";
import { CanvasLoader } from "@/features/scene-renderers/shared/CanvasLoader";
import {
  ADAPTIVE_SAMPLE_WINDOW_SECONDS,
  ADAPTIVE_SLOW_WINDOWS_BEFORE_ACTING,
  ADAPTIVE_WARM_UP_SECONDS,
  adaptiveDevicePixelRatio
} from "@/features/scene-renderers/shared/renderQuality";
import { PostEffects } from "@/features/scene-renderers/shared/PostEffects";
import { PlanetPositionTrackerContext } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { TerrainHeightSamplerContext, type TerrainHeightSampler } from "@/features/scene-renderers/shared/TerrainHeightSampler";

// planetIdentityKey is deliberately NOT re-exported here. It is a pure string
// helper, and re-exporting it made this module — with three.js behind it — a
// dependency of anything that only needed the key. Import it from
// scene-renderers/planetIdentity instead.

// The opening-shot numbers moved to universeCameraFraming: anything that has to
// place an object IN FRAME needs them too, and a private copy is what let the
// black hole drift behind the camera.

// Forest camera envelope: wide zoom-out to take in the whole treeline, and a
// polar clamp so the camera never dives under the ground plane (universe
// scenes have no ground and keep the default free orbit).
const FOREST_MINIMUM_CAMERA_DISTANCE = 3;
const FOREST_MAXIMUM_CAMERA_DISTANCE = 70;
// COUPLED to forestShoreCameraFraming: the opening shot grazes the water from
// as low as 4.3 degrees, which is a polar angle of 85.7. The previous 0.47*PI
// clamp (84.6) sat just inside that, so OrbitControls' first update would have
// silently tilted the shallowest seeds back up.
const FOREST_MAXIMUM_POLAR_ANGLE_RADIANS = Math.PI * 0.492;
// Render at native device resolution (the old 1.8 cap under-sampled every
// HiDPI display — a uniform blur). Quality-first scope: weak devices are
// explicitly out of scope for now.
//
// This is the CEILING, not a fixed setting. AdaptiveResolution below starts
// here and only ever steps back from it when frames are actually being missed,
// so a strong machine renders every pixel its display has and a 4K panel gets
// whatever the GPU can hold sixty frames at.
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 3];

/**
 * Holds the frame rate at or above sixty by giving back resolution, and only
 * resolution, and only when it has to.
 *
 * Measured on an RTX 4060 at 2560x1440 on a HiDPI display: the forest ran at 11
 * frames a second. Its draw calls and triangle count were identical to the
 * 100 fps case at 1600x900 — ten times the pixels, nine times the frame time,
 * the same geometry — so what it is short of is fill rate, and the only lever
 * that touches fill rate without touching what is IN the scene is how many
 * pixels the scene is drawn into.
 *
 * Everything about the policy is in renderQuality.ts and unit-tested. What is
 * here is the wiring: count frames over a window, hand the rate to the pure
 * function, apply what it returns. The policy is MONOTONIC — it only ever gives
 * resolution back — so there is nothing here to guard against oscillation.
 *
 * The frame counting is done here rather than with drei's PerformanceMonitor,
 * and that was measured too. The monitor reports a FACTOR that saturates: once
 * it has fully declined it stops firing `onChange`, so a scene needing three
 * steps got one and settled at 36 fps having been told it was finished.
 */
function AdaptiveResolution({ isSceneReady }: { isSceneReady: boolean }) {
  const setDpr = useThree((state) => state.setDpr);
  const renderer = useThree((state) => state.gl);
  // Seeded from what the renderer is ACTUALLY rendering at, never from the
  // canvas's ceiling. Seeding it from the ceiling was measured and was worse
  // than doing nothing: the range tops out at 3, a display at 2 starts there,
  // and the first "step down" from the ceiling computed 2.75 — RAISING the
  // ratio on a scene that was already too slow, taking a 30 fps forest to 19.
  const samplingReference = useRef({
    pixelRatio: renderer.getPixelRatio(),
    frames: 0,
    elapsedSeconds: 0,
    warmUpSeconds: 0,
    slowWindows: 0
  });

  useFrame((_, deltaSeconds) => {
    // Named 'sampling', not 'window': shadowing the global inside a hot frame
    // callback is exactly the kind of thing that reads fine and then bites.
    const sampling = samplingReference.current;
    if (!isSceneReady) {
      return;
    }
    if (sampling.warmUpSeconds < ADAPTIVE_WARM_UP_SECONDS) {
      sampling.warmUpSeconds += deltaSeconds;
      return;
    }
    sampling.frames += 1;
    sampling.elapsedSeconds += deltaSeconds;
    if (sampling.elapsedSeconds < ADAPTIVE_SAMPLE_WINDOW_SECONDS) {
      return;
    }
    const framesPerSecond = sampling.frames / sampling.elapsedSeconds;
    sampling.frames = 0;
    sampling.elapsedSeconds = 0;

    const nextPixelRatio = adaptiveDevicePixelRatio(sampling.pixelRatio, framesPerSecond);
    if (nextPixelRatio === sampling.pixelRatio) {
      sampling.slowWindows = 0;
      return;
    }
    // Two in a row, not one. A single slow window is a texture decode or a
    // collection, and giving up resolution for one is permanent — measured
    // walking a 219 fps universe down four steps on load-time readings alone.
    sampling.slowWindows += 1;
    if (sampling.slowWindows < ADAPTIVE_SLOW_WINDOWS_BEFORE_ACTING) {
      return;
    }
    sampling.slowWindows = 0;
    sampling.pixelRatio = nextPixelRatio;
    // Re-arm the warm-up: reallocating every render target makes the next frame
    // slow on its own, and measuring that would chase the change it just made.
    sampling.warmUpSeconds = 0;
    setDpr(nextPixelRatio);
  });

  return null;
}

/**
 * Mounts inside the scene's Suspense boundary, so its first rendered frame
 * means "textures resolved and pixels are on screen" — the moment the canvas
 * may fade in over the loading veil.
 */
function SceneReadySignal({ onSceneReady }: { onSceneReady: () => void }) {
  const hasSignaledReference = useRef(false);
  useFrame(() => {
    if (!hasSignaledReference.current) {
      hasSignaledReference.current = true;
      onSceneReady();
    }
  });
  return null;
}

type UniverseCanvasProps = {
  scene?: SceneConfig;
  className?: string;
  selectedPlanetKey?: string | null;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
  /**
   * Keep the GL backbuffer readable after each frame. Costs a driver fast-path
   * and extra memory, so it defaults to off; only the world page opts in
   * because its Export Image reads the canvas pixels.
   */
  preserveDrawingBuffer?: boolean;
  /** Device-pixel-ratio clamp; ambient backdrops pass a lower cap. */
  devicePixelRatioRange?: [number, number];
  /** Decorative backdrops (gallery) disable WASD/arrow camera movement. */
  enableKeyboardMove?: boolean;
  /**
   * Offer the scene's procedural ambience. Opted into by the create, world and
   * share pages — every route that shows one scene the visitor is looking at.
   * The gallery stays out: it mounts several canvases at once, and they would
   * all play over each other.
   */
  enableAmbientSound?: boolean;
  /**
   * How the scene arrives.
   *
   * `cinematic` — the full opening move plus a title card, for the one scene a
   * route exists to show (world, share).
   * `settle` — a short camera settle and a bare colour hold, for the create
   * page's live preview, which re-solves its framing on every option toggle and
   * would otherwise announce itself like a premiere each time.
   * `none` — arrive parked, for decorative backdrops.
   */
  entryMotion?: "cinematic" | "settle" | "none";
  /**
   * Something else is presenting this frame right now — currently the genie
   * reveal unfolding the scene out of the gallery card that opened it.
   *
   * While held, the canvas stays hidden and the opening camera move sits at its
   * first pose instead of advancing, so the still the reveal snapshotted keeps
   * matching the live frame it eventually hands back to.
   */
  revealHeld?: boolean;
  /**
   * Skip the reveal crossfade. For a route whose reveal is owned by something
   * that has already drawn the frame: fading in underneath it would dissolve
   * away the very thing that just arrived.
   */
  revealWithoutFade?: boolean;
  /** Fired on the frame the scene first renders, every time the canvas remounts. */
  onSceneReady?: () => void;
};

const CAMERA_INTRO_DURATION_SECONDS_BY_ENTRY_MOTION: Record<
  NonNullable<UniverseCanvasProps["entryMotion"]>,
  number
> = {
  cinematic: CAMERA_INTRO_DURATION_SECONDS,
  settle: CAMERA_SETTLE_DURATION_SECONDS,
  none: 0
};

/**
 * Thin canvas shell shared by every scene renderer. Resolves the renderer from
 * the scene theme via the registry, hosts camera, post-processing and the
 * hover overlay. Scene-specific visuals live in features/scene-renderers/.
 */
export function UniverseCanvas({
  scene,
  className,
  selectedPlanetKey,
  onSelectPlanet,
  preserveDrawingBuffer = false,
  devicePixelRatioRange = CANVAS_DEVICE_PIXEL_RATIO_RANGE,
  enableKeyboardMove = true,
  enableAmbientSound = false,
  entryMotion = "cinematic",
  revealHeld = false,
  revealWithoutFade = false,
  onSceneReady
}: UniverseCanvasProps) {
  const ambientSoundscape = useAmbientSoundscape(scene, enableAmbientSound);
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetSceneConfig | null>(null);
  const planetPositionTrackerReference = useRef<Map<string, Vector3>>(new Map());
  // Only a family with a ground plane the camera can clip through (currently
  // ocean) ever writes into this; CameraRig's clamp is a no-op while it is null.
  const terrainHeightSamplerReference = useRef<TerrainHeightSampler>({ current: null });
  // Readiness is DERIVED from the remount key instead of reset in an effect:
  // the same render that swaps the canvas already sees isSceneReady=false,
  // so the veil covers the swap without a single black frame leaking through.
  const [lastReadyCanvasKey, setLastReadyCanvasKey] = useState<string | null>(null);

  const seed = String(scene?.seed ?? CANONICAL_FALLBACK_SEED);
  const backgroundColor = backgroundColorFromScene(scene);
  const cameraDistance = cameraDistanceFromConfig(scene?.camera);
  const cameraFieldOfView = cameraFieldOfViewFromConfig(scene?.camera);
  // Planets for universe scenes, landmarks for forest scenes — one adapter so
  // hover/select/camera-focus work identically across families.
  const pointsOfInterest = pointsOfInterestFromScene(scene);
  const hasConfiguredPointsOfInterest = pointsOfInterest.length > 0;

  // Family first (sceneType), then universe theme, then the abstract fallback
  // for configs with no renderable content at all.
  const sceneTypeRenderer = resolveSceneTypeRenderer(scene);
  const SceneRenderer =
    sceneTypeRenderer ?? (hasConfiguredPointsOfInterest ? resolveSceneRenderer(scene?.theme) : FallbackUniverseRenderer);
  const isForestFamilyScene = isForestScene(scene);
  const isOceanFamilyScene = isOceanScene(scene);

  // Forest scenes open from the lake's near bank instead of above its middle:
  // the framing is derived from the lake the renderer builds, which the
  // backend's rolled camera.distance cannot know about. Memoized because a hover
  // re-renders this component and the solve rebuilds the terrain sampler.
  const forestCameraFraming = useMemo(
    () => (isForestFamilyScene ? forestShoreCameraFraming(scene?.terrain, cameraFieldOfView) : null),
    [isForestFamilyScene, scene?.terrain, cameraFieldOfView]
  );
  // The ocean frames itself for the same reason the forest does: the shared
  // framing points the camera down at a target, and in a medium you are inside
  // that aims at the floor underwater and past the horizon in air.
  const oceanCameraFraming = isOceanFamilyScene
    ? oceanCameraFramingFor(
        cameraDistance,
        scene?.depth?.metres ?? 20,
        scene?.water?.visibilityMetres ?? 30,
        scene?.lighting?.surfaceAzimuthRadians,
        scene?.depth?.seafloorMetres,
      )
    : null;
  const cameraPosition: [number, number, number] = forestCameraFraming
    ? [0, forestCameraFraming.height, forestCameraFraming.distance]
    : oceanCameraFraming
      ? [oceanCameraFraming.x, oceanCameraFraming.y, oceanCameraFraming.z]
      : universeCameraPosition(scene?.camera);

  const hoveredPlanetKey = hoveredPlanet
    ? planetIdentityKey(
        hoveredPlanet,
        pointsOfInterest.findIndex((pointOfInterest) => pointOfInterest === hoveredPlanet)
      )
    : null;

  // The key has to carry the position actually used, not the config's distance:
  // a forest's framing comes from its lake, so the same rolled distance can want
  // two different camera positions.
  const canvasRemountKey = `${seed}-${cameraPosition[1].toFixed(2)}-${cameraPosition[2].toFixed(2)}-${cameraFieldOfView}`;
  const isSceneReady = lastReadyCanvasKey === canvasRemountKey;

  const introDurationSeconds = CAMERA_INTRO_DURATION_SECONDS_BY_ENTRY_MOTION[entryMotion];
  const titleCardName = entryMotion === "cinematic" ? scene?.sceneName?.trim() : undefined;
  const isCanvasVisible = isSceneReady && !revealHeld;
  // Armed by readiness, not by mount: the move has to be the first thing the
  // visitor sees, and a scene that took two seconds to resolve would otherwise
  // reveal a camera that had already finished arriving.
  const introPhase = !isSceneReady ? "waiting" : revealHeld ? "held" : "running";

  return (
    <div
      className={`relative h-full min-h-[320px] overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor, cursor: hoveredPlanet ? "pointer" : "grab" }}
    >
      <div
        className={`h-full w-full transition-opacity ease-out ${
          revealWithoutFade ? "duration-0" : "duration-1000"
        } ${isCanvasVisible ? "opacity-100" : "opacity-0"}`}
      >
        <Canvas
          key={canvasRemountKey}
          camera={{ position: cameraPosition, fov: cameraFieldOfView }}
          // The forest (sun through the canopy) and the ocean (a single key
          // light through water) both cast real shadows; universe scenes are
          // emissive-lit and have no ground to receive one, so they skip the
          // pass. The ocean was missing from this list for its whole life, which
          // made every castShadow/receiveShadow in its rig inert — and a seabed
          // with no contact shadow is why its boulders read as flat blobs
          // sitting ON a plane rather than resting IN sediment.
          shadows={isForestFamilyScene || isOceanFamilyScene ? "soft" : false}
          dpr={devicePixelRatioRange}
          // AgX rolls hot highlights off more gracefully than the default ACES
          // (no neon clipping on lit planets); sky layers opt out via
          // toneMapped={false} and are unaffected.
          //
          // The ocean is the exception, and it is not a preference. That family's
          // whole grade was designed and proven against three.js's own ACES at a
          // per-depth `toneMappingExposure` — the adaptation curve IS the
          // exposure — so it needs the curve the design was measured with, not a
          // second one applied on top of it.
          gl={{
            preserveDrawingBuffer,
            powerPreference: "high-performance",
            toneMapping: isOceanFamilyScene ? ACESFilmicToneMapping : AgXToneMapping,
          }}
          onPointerMissed={() => onSelectPlanet?.(null)}
        >
          <color attach="background" args={[backgroundColor]} />
          <PlanetPositionTrackerContext.Provider value={planetPositionTrackerReference.current}>
          <TerrainHeightSamplerContext.Provider value={terrainHeightSamplerReference.current}>
            <Suspense fallback={<CanvasLoader />}>
              <SceneRenderer
                scene={scene ?? {}}
                seed={seed}
                selectedPlanetKey={selectedPlanetKey ?? null}
                hoveredPlanetKey={hoveredPlanetKey}
                onHoverPlanet={setHoveredPlanet}
                onSelectPlanet={onSelectPlanet}
              />
              {/* The ocean renders STRAIGHT TO THE CANVAS, with no composer.
                  Not a tuning choice — a correctness one. EffectComposer sets
                  gl.toneMapping = NoToneMapping on mount and expects a
                  <ToneMapping> effect in the chain, which this one has never
                  had. So for the ocean's whole life its tone curve was a
                  passthrough, `toneMappingExposure` was read by nothing, and
                  every linear value above 1 clipped flat to white — the cause
                  of every washed-out ocean frame reported so far.
                  Bypassing the chain restores the renderer's own ACES, makes
                  the per-depth exposure live again, and removes the need for
                  the hand-injected curve that stood in for it. */}
              {isOceanFamilyScene ? null : (
                <PostEffects
                  postFX={scene?.postFX}
                  theme={scene?.theme}
                  ambientOcclusion={isForestFamilyScene}
                />
              )}
              <SceneReadySignal
                onSceneReady={() => {
                  setLastReadyCanvasKey(canvasRemountKey);
                  onSceneReady?.();
                }}
              />
            </Suspense>
            <AdaptiveResolution isSceneReady={isSceneReady} />
            <CameraRig
              selectedPlanetKey={selectedPlanetKey ?? null}
              minimumDistance={isForestFamilyScene ? FOREST_MINIMUM_CAMERA_DISTANCE : undefined}
              maximumDistance={isForestFamilyScene ? FOREST_MAXIMUM_CAMERA_DISTANCE : undefined}
              maximumPolarAngleRadians={isForestFamilyScene ? FOREST_MAXIMUM_POLAR_ANGLE_RADIANS : undefined}
              keyboardMoveEnabled={enableKeyboardMove}
              restingTarget={oceanCameraFraming?.target}
              introDurationSeconds={introDurationSeconds}
              introPhase={introPhase}
              introPoseSeed={seed}
            />
          </TerrainHeightSamplerContext.Provider>
          </PlanetPositionTrackerContext.Provider>
        </Canvas>
      </div>
      {/* The hold before the scene arrives. Deliberately NOT a spinner: a pair
          of counter-spinning rings used to sit here, and it said nothing about
          the world being built behind it — a generic wait widget in front of a
          product whose whole promise is that the world is yours. What replaces
          it is the world's own background colour (already painted by the
          wrapper, which is why this layer stays transparent) and, on the routes
          that exist to show one scene, that scene's name. The reveal itself is
          the event: the canvas dissolves up underneath while the card lifts
          away, and CameraRig's opening move carries it from there.

          Nothing animates during the wait on purpose. A wait that does not
          fidget reads as composure; the motion is saved for the arrival. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 grid place-items-center transition-opacity duration-700 ease-out ${
          isSceneReady ? "opacity-0 delay-200" : "opacity-100"
        }`}
      >
        {titleCardName ? (
          <div
            className={`flex flex-col items-center gap-2.5 px-8 text-center transition-transform duration-1000 ease-out ${
              isSceneReady ? "-translate-y-1.5" : "translate-y-0"
            }`}
          >
            {scene?.archetype ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass/85">{scene.archetype}</p>
            ) : null}
            <p className="font-display text-lg font-medium tracking-wide text-white/75">{titleCardName}</p>
            <span className="mt-1 h-px w-14 bg-white/20" />
          </div>
        ) : null}
      </div>
      {hoveredPlanet ? (
        <div className="pointer-events-none absolute bottom-[68px] left-4 z-10 max-w-xs rounded-lg border border-white/15 bg-black/55 px-3 py-2 backdrop-blur">
          <p className="text-sm font-semibold text-on-surface">{hoveredPlanet.name ?? "Unknown planet"}</p>
          {typeof hoveredPlanet.energy === "number" ? (
            <p className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">
              Energy {hoveredPlanet.energy}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-lowest/65 to-transparent" />
      {/* Bottom-right cluster. One positioned container rather than two: the
          sound toggle stacks above the movement hint, and the hint is hidden on
          phones, so two absolute boxes would leave a gap on mobile. */}
      <div className="pointer-events-none absolute bottom-[68px] right-4 z-10 flex flex-col items-end gap-2">
        {enableAmbientSound && isSceneReady ? (
          <AmbientSoundToggle
            isEnabled={ambientSoundscape.isEnabled}
            isSupported={ambientSoundscape.isSupported}
            isLoading={ambientSoundscape.isLoading}
            onToggle={ambientSoundscape.toggle}
          />
        ) : null}
        {enableKeyboardMove && isSceneReady ? (
          <p className="hidden rounded-md border border-white/10 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/50 backdrop-blur sm:block">
            WASD / arrows to move · drag to orbit · scroll to zoom
          </p>
        ) : null}
      </div>
    </div>
  );
}
