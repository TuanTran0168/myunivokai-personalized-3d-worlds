"use client";

import { Canvas, useFrame } from "@react-three/fiber";
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
import { CanvasLoader } from "@/features/scene-renderers/shared/CanvasLoader";
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
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 3];

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
  enableAmbientSound = false
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

  return (
    <div
      className={`relative h-full min-h-[320px] overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor, cursor: hoveredPlanet ? "pointer" : "grab" }}
    >
      <div
        className={`h-full w-full transition-opacity duration-700 ease-out ${
          isSceneReady ? "opacity-100" : "opacity-0"
        }`}
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
              <SceneReadySignal onSceneReady={() => setLastReadyCanvasKey(canvasRemountKey)} />
            </Suspense>
            <CameraRig
              selectedPlanetKey={selectedPlanetKey ?? null}
              minimumDistance={isForestFamilyScene ? FOREST_MINIMUM_CAMERA_DISTANCE : undefined}
              maximumDistance={isForestFamilyScene ? FOREST_MAXIMUM_CAMERA_DISTANCE : undefined}
              maximumPolarAngleRadians={isForestFamilyScene ? FOREST_MAXIMUM_POLAR_ANGLE_RADIANS : undefined}
              keyboardMoveEnabled={enableKeyboardMove}
              restingTarget={oceanCameraFraming?.target}
            />
          </TerrainHeightSamplerContext.Provider>
          </PlanetPositionTrackerContext.Provider>
        </Canvas>
      </div>
      {/* Loading veil: option toggles change the preview seed, which remounts
          the whole canvas — the veil turns that swap into an intentional
          crossfade (armillary-style counter-spinning brass rings) instead of
          a black flash. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 grid place-items-center transition-opacity duration-500 ${
          isSceneReady ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <span className="relative h-12 w-12">
            <span className="absolute inset-0 animate-spin rounded-full border border-white/10 border-t-brass" />
            <span className="absolute inset-2 animate-spin rounded-full border border-white/10 border-b-brass [animation-direction:reverse] [animation-duration:1.6s]" />
          </span>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">
            {isForestFamilyScene ? "Rendering forest" : "Rendering universe"}
          </p>
        </div>
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
