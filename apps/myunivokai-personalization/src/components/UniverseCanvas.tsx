"use client";

import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import type { Vector3 } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, isForestScene, isOceanScene, pointsOfInterestFromScene, CANONICAL_FALLBACK_SEED } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { resolveSceneRenderer, resolveSceneTypeRenderer } from "@/features/scene-renderers/registry";
import { FallbackUniverseRenderer } from "@/features/scene-renderers/fallback/FallbackUniverseRenderer";
import {
  oceanCameraFraming as oceanCameraFramingFor,
  oceanCameraCeilingMetres,
  oceanCameraFloorMetres
} from "@/features/scene-renderers/ocean/oceanMath";
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
import { WebGLFailureBoundary } from "@/features/scene-renderers/shared/WebGLFailureBoundary";
import { useDeviceQualityTier } from "@/features/scene-renderers/shared/useDeviceQualityTier";
import {
  clientRenderBackendOf,
  clientRenderFamilyForSceneType,
  reportClientRender,
  CLIENT_RENDER_BACKEND_UNKNOWN,
  CLIENT_RENDER_OUTCOME_RENDERED,
  CLIENT_RENDER_OUTCOME_WEBGL_FAILED,
  type ClientRenderGraphicsBackend
} from "@/features/scene-renderers/shared/reportClientRender";
import {
  ADAPTIVE_SAMPLE_WINDOW_SECONDS,
  ADAPTIVE_SLOW_WINDOWS_BEFORE_ACTING,
  ADAPTIVE_WARM_UP_SECONDS,
  adaptiveDevicePixelRatio,
  composerMultisamplingFor
} from "@/features/scene-renderers/shared/renderQuality";
import { PostEffects } from "@/features/scene-renderers/shared/PostEffects";
import { NodePostEffects } from "@/features/scene-renderers/shared/NodePostEffects";
import { SceneStillBridge } from "@/features/scene-renderers/shared/SceneStillBridge";
import { ComposedFrameDrawerContext } from "@/features/scene-renderers/shared/sceneStillCapture";
import { rendererToneMappingForFamily } from "@/features/scene-renderers/shared/sceneToneMapping";
import { loadNodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import { parityHarnessRequest } from "@/features/scene-renderers/shared/parityHarness";
import { ParityHarnessBridge } from "@/features/scene-renderers/shared/ParityHarnessBridge";
import {
  buildsNodeRenderer,
  forcesWebGLBackend,
  nodeRendererRollout,
  rendererDecisionFor,
  rendererDecisionNeedsAdapterAnswer,
  rendererRemountSuffix
} from "@/features/scene-renderers/shared/rendererSelection";
import { useWebGPUAdapterAvailability } from "@/features/scene-renderers/shared/useWebGPUAdapterAvailability";
import { watchGraphicsDevice } from "@/features/scene-renderers/shared/graphicsDeviceLoss";
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
// Only worlds stored before the service began carrying a wind speed reach this,
// and for those OceanRenderer derives one from the seed anywhere in 5-13 m/s.
// The ceiling has to hold for whichever it lands on, so it is solved for the
// windiest — the sea with the deepest troughs — at the cost of a couple of
// metres of headroom in a handful of legacy worlds. Matches the top of
// windSpeedFromSeed's own band in OceanRenderer.tsx.
const OCEAN_FALLBACK_WIND_SPEED_METRES_PER_SECOND = 13;
// Render at native device resolution (the old 1.8 cap under-sampled every
// HiDPI display — a uniform blur).
//
// This is the CEILING, not a fixed setting. AdaptiveResolution below starts
// here and only ever steps back from it when frames are actually being missed,
// so a strong machine renders every pixel its display has and a 4K panel gets
// whatever the GPU can hold sixty frames at.
//
// Updated by S7-FE-ADAPTIVE-001: this line used to end "weak devices are
// explicitly out of scope for now", and they no longer are. The value here is
// the TOP tier's ceiling and remains exactly what it was; a device classified
// below that tier starts lower. See shared/deviceQualityTier.ts, whose test
// asserts the top tier still equals this pair.
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 3];

/**
 * Skips a synchronous diagnostic readback on every shader program's first use.
 *
 * `WebGLRenderer.debug.checkShaderErrors` (on by default) has three.js read
 * `getProgramInfoLog` back from the driver the first time each program is
 * bound, purely to print a message if the link failed. `gl.linkProgram` above
 * it already queued that work without blocking; the log READ is what forces
 * the driver to stop and wait for a link it would otherwise finish on its own
 * schedule. Kept on in development so a real shader error still prints
 * instead of the scene silently rendering nothing.
 *
 * On its own this is a small, real saving, not a fix for the freeze a first
 * scene mount causes (see the note on `canvasRemountKey` for what that freeze
 * actually is and why it was left alone). Profiling with this off showed the
 * same multi-second stall move into `getProgramParameter`, three.js's other
 * call in the same first-use path, reading back active uniform/attribute
 * locations — not optional the way the error log is, since three.js cannot
 * build its uniform-setter map without it.
 *
 * `WebGLRenderer.compileAsync`, the standard fix for exactly this class of
 * freeze, was tried and measured to do nothing on this project's ANGLE/D3D11
 * target: `KHR_parallel_shader_compile` is present (confirmed by reading
 * `getSupportedExtensions()` off a throwaway context), but its completion
 * query blocked for the SAME ~2.5-3s the plain path did, in both headless and
 * headed real Chrome — this driver does not honour the extension's
 * non-blocking contract. Left out rather than shipped as dead weight.
 */
function disableShaderErrorCheckingInProduction(state: RootState) {
  if (process.env.NODE_ENV === "production") {
    state.gl.debug.checkShaderErrors = false;
  }
}

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
function SceneReadySignal({ onSceneReady }: { onSceneReady: (graphicsBackend: ClientRenderGraphicsBackend) => void }) {
  const hasSignaledReference = useRef(false);
  // THE BACKEND IS READ FROM THE RENDERER, AND THIS COMPONENT IS WHY IT CAN BE.
  // It is inside the <Canvas>, so it can ask the instance what it is; the
  // component holding the telemetry is outside and only knows what it asked
  // for. Those two answers differ for exactly the population §19.5 is trying to
  // count — a WebGPURenderer that fell back to its WebGL2 backend.
  const renderer = useThree((state) => state.gl);
  useFrame(() => {
    if (!hasSignaledReference.current) {
      hasSignaledReference.current = true;
      onSceneReady(clientRenderBackendOf(renderer));
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
  devicePixelRatioRange,
  enableKeyboardMove = true,
  enableAmbientSound = false,
  entryMotion = "cinematic",
  revealHeld = false,
  revealWithoutFade = false,
  onSceneReady
}: UniverseCanvasProps) {
  // The parity harness's request, resolved once per mount for the same reason
  // the classifications below are: which renderer to build is a decision the
  // canvas makes when it is created. `null` in every build that does not set
  // NEXT_PUBLIC_PARITY_HARNESS, which is every build but the harness's own.
  const parityHarness = useMemo(
    () => parityHarnessRequest(typeof window === "undefined" ? undefined : window.location.search),
    []
  );

  /**
   * Whether a `GPUDevice` has been lost on this page.
   *
   * One-way, and it survives the remount it causes because this state lives
   * ABOVE the `<Canvas>` that is being replaced. §26 Phase 9 / §18.3(b): the
   * recovery is a remount onto the WebGL2 backend rather than rebuilding every
   * buffer, texture and pipeline on a fresh device.
   */
  const [graphicsDeviceLost, setGraphicsDeviceLost] = useState(false);

  /**
   * WHICH ROLLOUT THIS BUILD SHIPS, read once.
   *
   * Unset in production, which now means ON — the node renderer wherever the
   * browser has a real WebGPU adapter. See `rendererSelection.ts` for what the
   * other two values do and why the default moved.
   */
  const rollout = useMemo(() => nodeRendererRollout(), []);

  /**
   * Whether this page has to ask `navigator.gpu` before it can build anything.
   *
   * False for the harness, false under the kill switch, false when the rollout
   * is `every-visitor`, and false once a device has been lost — in every one of
   * those the renderer is already determined, and probing would be a driver
   * call made to answer a question nothing asked.
   */
  const needsAdapterAnswer = rendererDecisionNeedsAdapterAnswer({
    harnessRenderer: parityHarness?.renderer ?? null,
    rollout,
    graphicsDeviceLost
  });

  const webgpuAdapter = useWebGPUAdapterAvailability(needsAdapterAnswer);

  /**
   * WHICH RENDERER THIS CANVAS BUILDS — the one decision §26 Phase 9 adds, kept
   * as a pure function in `rendererSelection.ts` so it can be argued with and
   * tested without a GPU.
   *
   * **`isDecided` is false only while the adapter probe is outstanding**, and
   * the canvas below is not rendered until it is true. That is the safety
   * property that replaced "the flag ships off": a renderer cannot be changed
   * after the `gl` factory has run, so the one moment this can be got right is
   * before the `<Canvas>` exists.
   */
  const rendererDecision = useMemo(
    () =>
      rendererDecisionFor({
        harnessRenderer: parityHarness?.renderer ?? null,
        rollout,
        webgpuAdapter,
        graphicsDeviceLost
      }),
    [parityHarness, rollout, webgpuAdapter, graphicsDeviceLost]
  );
  const rendererChoice = rendererDecision.choice;

  /**
   * Whether the renderer this canvas gets is a NODE renderer, which decides
   * which post chain can mount at all.
   *
   * Derived from the same expression the `gl` prop uses, rather than from a
   * second reading of the request: both of the harness's non-WebGL renderers are
   * `WebGPURenderer`, one on each backend, and it is the RENDERER CLASS and not
   * the backend that `RenderPipeline` requires. Keeping the two derivations
   * beside each other is deliberate — a canvas rendering with a node renderer
   * and mounting the composer would fail at construction, before a frame, with
   * the whole canvas replaced by the failure boundary.
   */
  const rendersWithNodePipeline = buildsNodeRenderer(rendererChoice);

  // Classified once per mount, before the first frame, because shadows and the
  // postprocessing chain are decided when the canvas is created and cannot be
  // walked back by a frame-rate reading the way the pixel ratio can.
  //
  // THE WEBGPU ADAPTER IS PROBED ONLY WHEN IT IS GOING TO DRAW. The WebGL probe
  // this hook has always done reads a throwaway WebGL context, which cannot see
  // a machine whose WEBGPU device is a CPU rasteriser — that machine answers
  // "RTX 4060" and then renders every frame on the processor, at the top tier.
  // Asking costs one `requestAdapter()`; asking on the classic path would cost
  // it for an adapter nothing touches. §18.3(a).
  const deviceRenderProfile = useDeviceQualityTier({
    probesWebGPUAdapter: buildsNodeRenderer(rendererChoice) && !forcesWebGLBackend(rendererChoice)
  });
  // An explicit range from a caller still wins. The share page and the create
  // preview both pass one, and a device tier is not entitled to overrule a
  // decision the calling screen made about its own layout.
  const activeDevicePixelRatioRange = devicePixelRatioRange ?? deviceRenderProfile.devicePixelRatioRange;
  const ambientSoundscape = useAmbientSoundscape(scene, enableAmbientSound);
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetSceneConfig | null>(null);
  const planetPositionTrackerReference = useRef<Map<string, Vector3>>(new Map());
  /**
   * Which call draws a composed frame, for the still capture to reuse.
   *
   * Written by `NodePostEffects` when it owns the frame, left null for the
   * ocean, which mounts no chain. A ref rather than state on purpose: nothing
   * re-renders when it changes, and the one reader asks for it inside a click
   * handler. See `sceneStillCapture.ts`.
   */
  const composedFrameDrawerReference = useRef<(() => void) | null>(null);
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
        scene?.lighting?.surfaceElevationRadians,
      )
    : null;
  // How high the ocean's lens may go before it is out of its own sea. The
  // renderer decides above-or-below ONCE, when it builds the rig, so a camera
  // that leaves the water leaves a rig that still believes it is submerged —
  // see oceanCameraCeilingMetres for what that looks like on screen and why the
  // bug only ever showed at the wide end of the zoom.
  const oceanCameraCeiling = isOceanFamilyScene
    ? oceanCameraCeilingMetres(
        scene?.depth?.metres ?? 20,
        scene?.water?.windSpeedMetresPerSecond ?? OCEAN_FALLBACK_WIND_SPEED_METRES_PER_SECOND,
      )
    : null;
  // And the mirror of it: how low the lens may go before it is INSIDE a sea its
  // rig was built to stand on. Only an above-water ocean world has one — see
  // oceanCameraFloorMetres for why arriving under that surface is not the same
  // as being underwater.
  const oceanCameraFloor = isOceanFamilyScene
    ? oceanCameraFloorMetres(
        scene?.depth?.metres ?? 20,
        scene?.water?.windSpeedMetresPerSecond ?? OCEAN_FALLBACK_WIND_SPEED_METRES_PER_SECOND,
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
  //
  // This key changing tears down the whole WebGL context, and that is
  // EXPENSIVE — but as of the investigation below it is also load-bearing, so
  // read this before trying to make it cheaper.
  //
  // React unmounting the old <Canvas> makes r3f call `forceContextLoss()` and
  // then `dispose(scene)`, and that dispose walks every object AND ITS PROPS,
  // so it frees the geometries, the materials, the compiled programs and the
  // uploaded textures in one synchronous sweep. Measured on this page with a
  // long-task observer, that sweep-and-rebuild costs:
  //
  //   toggle one interest chip     1108 ms blocked
  //   fill in the nickname field   1575 ms blocked
  //   switch family to forest      2108 ms blocked
  //
  // A CPU profile put 1121 ms of the family switch inside `texSubImage2D`,
  // re-uploading the universe family's 8K textures (8192x4096 is 134 MB of
  // RGBA once decoded, before mipmaps), and most of the rest in
  // `getProgramParameter`, re-linking its shader programs.
  //
  // The obvious fix — keep ONE <Canvas> for the page's whole life, move the
  // key down onto the scene contents, and apply the camera pose and tone curve
  // imperatively (r3f creates the camera once and passes `gl` straight to the
  // WebGLRenderer constructor, so neither is re-read from props) — was built
  // and measured. Its first switch is a big win: 2108 ms -> 401 ms, and
  // `texSubImage2D` disappears from the profile entirely.
  //
  // It was REVERTED because it leaks, unboundedly, and the leak is worse than
  // the stall. Reading `renderer.info` after each change, with the context
  // kept alive:
  //
  //   six family switches   geometries  58 -> 323, textures 37 -> 214, programs  26 -> 361
  //   ten form edits        geometries  58 -> 518, textures 37 -> 105, programs  26 -> 215
  //
  // Nothing is ever released, and the block time climbs with it — the tenth
  // form edit cost 2185 ms, worse than the remount it replaced. The cause is
  // that r3f only frees a removed object via `disposeOnIdle`, which schedules
  // the work at React's *IdlePriority*; a scene rendering continuously never
  // yields an idle slot, so the queue is never drained. The synchronous
  // `dispose(scene)` on full unmount is the only thing that actually collects
  // this scene graph today.
  //
  // Making the persistent canvas correct therefore means giving each renderer
  // family explicit ownership of its own GPU resources, which cannot be done
  // by a blanket traverse-and-dispose from here: the forest's meshes share
  // geometry with the `useLoader` GLTF cache (three's `clone()` shares
  // geometry and material references), so disposing what a scene traverse
  // finds would break the cache for every later mount. That is a real,
  // separate piece of work per family, and is not what shipped here.
  //
  // What DOES already help, for anyone using their normal Chrome rather than a
  // fresh profile: Chrome keeps compiled shader BINARIES in an on-disk cache
  // keyed by source, independent of any one page's WebGLRenderer. Measured
  // with a persistent browser profile: the second time the forest's shaders
  // are ever compiled on a machine — even in a brand new tab, brand new
  // context, brand new renderer — the same program readback drops from ~2.5s
  // to ~230ms.
  //
  // The renderer suffix is what turns a lost GPU device into a recovery: nothing
  // about a renderer can change without a new `<Canvas>`, because the `gl`
  // factory is called once per canvas. Empty for every ordinary choice, so no
  // key moves for anybody until a device is actually lost.
  const canvasRemountKey = `${seed}-${cameraPosition[1].toFixed(2)}-${cameraPosition[2].toFixed(2)}-${cameraFieldOfView}${rendererRemountSuffix(rendererDecision)}`;
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
      {/* OUTSIDE the fade wrapper, and the placement is the whole point.
          The wrapper below holds opacity-0 until the scene signals ready, and
          a canvas that failed never signals anything — so a boundary nested
          inside it would render its message at zero opacity, leaving the
          visitor looking at an empty rectangle. Which is the exact failure
          this exists to end. */}
      <WebGLFailureBoundary
        // The boundary stays free of telemetry and reports through the prop it
        // already had. It is the canvas that knows the tier and the family, and
        // a boundary that fetched them itself would be a second copy of the
        // classification.
        onFailure={() => {
          reportClientRender({
            qualityTier: deviceRenderProfile.tier,
            family: clientRenderFamilyForSceneType(scene?.sceneType),
            outcome: CLIENT_RENDER_OUTCOME_WEBGL_FAILED,
            // UNKNOWN, and not a guess at what was being built. This boundary
            // catches a canvas that never got a context or lost the one it
            // had — so there is no renderer instance to ask, and the one thing
            // worse than not knowing which backend failed is recording a
            // plausible answer.
            graphicsBackend: CLIENT_RENDER_BACKEND_UNKNOWN
          });
        }}
      >
        <div
          className={`h-full w-full transition-opacity ease-out ${
            revealWithoutFade ? "duration-0" : "duration-1000"
          } ${isCanvasVisible ? "opacity-100" : "opacity-0"}`}
        >
          {/* NOT MOUNTED UNTIL THE RENDERER IS DECIDED, and this conditional is
              the whole of the rollout's safety.

              `rendererDecision.isDecided` is false in exactly one state: the
              rollout is `where-webgpu-is-real` and `navigator.gpu` has not
              answered yet. Mounting during that state would build whichever
              renderer the default happened to be, and a renderer cannot be
              changed afterwards — the `gl` factory runs once per `<Canvas>`, so
              correcting it would mean a remount, which is this app's most
              expensive operation and the one §26 spent its length shortening.

              The wait is one `requestAdapter()`, 1 to 15 ms in Phase 0's
              numbers and hard-bounded by
              WEBGPU_ADAPTER_PROBE_TIMEOUT_MILLISECONDS. It is invisible: the
              wrapper above holds opacity-0 until the scene signals ready, which
              is seconds away, and the hold layer below is already painted. */}
          {!rendererDecision.isDecided ? null : (
          <Canvas
            key={canvasRemountKey}
            // "never" from the FIRST frame when the parity harness is driving,
            // and that is not the same thing as switching it off once the scene
            // has mounted.
            //
            // Setting it from inside an effect was tried and measured: R3F runs
            // some number of real frames before the effect fires, the count
            // depends on how fast the page loaded, and anything that INTEGRATES
            // rather than reads the clock — the camera easing, a drifter's
            // position, AdaptiveResolution's frame counter — carries that
            // difference into the pinned frame. Two runs of the identical
            // renderer disagreed by a worst-block error of 60 with 5.8% of
            // pixels differing, which is the harness failing its own stability
            // gate. As a prop, no frame the scene ever draws is one the harness
            // did not drive.
            frameloop={parityHarness ? "never" : "always"}
            camera={{ position: cameraPosition, fov: cameraFieldOfView }}
            // The forest (sun through the canopy) and the ocean (a single key
            // light through water) both cast real shadows; universe scenes are
            // emissive-lit and have no ground to receive one, so they skip the
            // pass. The ocean was missing from this list for its whole life, which
            // made every castShadow/receiveShadow in its rig inert — and a seabed
            // with no contact shadow is why its boulders read as flat blobs
            // sitting ON a plane rather than resting IN sediment.
            // The tier gates this, the family chooses it. A device that cannot
            // afford shadow mapping is not asked; one that can gets exactly the
            // behaviour it had before tiering existed.
            //
            // "percentage", not "soft", since three.js r182. R3F maps "soft" to
            // `PCFSoftShadowMap` and three now REPLACES that at render time:
            // `WebGLShadowMap.render` warns "PCFSoftShadowMap has been
            // deprecated. Using PCFShadowMap instead." and assigns
            // `this.type = PCFShadowMap` (three.module.js:9148-9151). So asking
            // for "soft" bought a console warning on every frame and the other
            // filter anyway. "percentage" IS `PCFShadowMap`, which r186 notes is
            // "now soft as well" — the name changed, the picture did not.
            shadows={
              deviceRenderProfile.allowsShadows && (isForestFamilyScene || isOceanFamilyScene) ? "percentage" : false
            }
            dpr={activeDevicePixelRatioRange}
            // AgX rolls hot highlights off more gracefully than the default ACES
            // (no neon clipping on lit planets). The ocean is the exception, and
            // it is not a preference: that family's whole grade was designed and
            // proven against three.js's own ACES at a per-depth
            // `toneMappingExposure` — the adaptation curve IS the exposure — so
            // it needs the curve the design was measured with, not a second one
            // applied on top of it.
            //
            // THIS PROPERTY IS ONLY LIVE FOR THE OCEAN, and knowing that is the
            // point of reading it from sceneToneMapping.ts: every other family
            // mounts <PostEffects>, whose EffectComposer overwrites
            // gl.toneMapping with NoToneMapping on mount. Those families get the
            // same curve from a composer pass instead, derived from the same
            // constant, and sceneToneMapping.test.ts asserts the two agree.
            //
            // The claim that "sky layers opt out via toneMapped={false} and are
            // unaffected" used to sit here and was wrong twice over: with
            // NoToneMapping there was no curve to opt out of, and a fullscreen
            // composer pass cannot honour a per-material flag. The solar
            // system's seven toneMapped={false} sites now mean "keep my >1 HDR
            // values out of the in-shader curve so bloom can select on them",
            // which is what they were reaching for, and the frame-wide curve
            // rolls those values off at the end instead of clipping them.
            gl={
              buildsNodeRenderer(rendererChoice)
                ? // The node renderer, and the reason this prop is a
                  // FUNCTION: @react-three/fiber 9.7.0 awaits
                  // the `gl` prop when it is one, so `WebGPURenderer.init()` —
                  // which is async, and which is where the WebGL fallback is
                  // decided — can complete before the first frame. Verified
                  // from fiber's own source in §6.5 of the feasibility report;
                  // this is the first place the app uses it.
                  //
                  // `three/webgpu` is imported dynamically. It is a second copy
                  // of three, ~1 MB, and a static import would put it in the
                  // main bundle of every visitor to serve a harness that only
                  // runs on one machine.
                  async (canvasProperties: Record<string, unknown>) => {
                    // BOTH node modules, not just the renderer's, and this is
                    // the load-bearing half of `shared/nodeMaterials.ts`.
                    //
                    // Every material Phases 6-8 port has to be constructed
                    // SYNCHRONOUSLY, from inside a component or from a GLB walk,
                    // and no component can await an import in its render. Fiber
                    // awaits this factory before mounting a single child, so
                    // this is the one place in the app where the wait is free.
                    // After it, `loadedNodeMaterialModules()` answers
                    // synchronously for the whole tree.
                    const { webgpu } = await loadNodeMaterialModules();
                    const { WebGPURenderer } = webgpu;
                    const renderer = new WebGPURenderer({
                      ...canvasProperties,
                      antialias: true,
                      powerPreference: "high-performance",
                      // `preserveDrawingBuffer` IS NOT PASSED, AND NOT BECAUSE
                      // IT WAS FORGOTTEN. §18.3(c) asks for a deliberate
                      // decision about it, and the decision available is
                      // narrower than the question: **the option does not exist
                      // on this renderer.** Zero occurrences of the string in
                      // `three.webgpu.js`, against two in `three.module.js`
                      // (`:16074` reads it out of the parameters, `:16372`
                      // hands it to `getContext`), and `WebGPURendererParameters`
                      // does not declare it — passing it is a typecheck error
                      // rather than a silent no-op, which is the one piece of
                      // luck here.
                      //
                      // So the two readback sites (§10.3) are on their own,
                      // and the measurement is in: `node-path-diagnostic.spec.ts`
                      // samples the canvas the way both of them do, and BOTH
                      // node backends read back fully transparent — 0 of 256
                      // samples carrying any alpha, against 256 of 256 on the
                      // classic renderer. The WebGL2 backend failing too is what
                      // rules out WebGPU present-time semantics: it is the same
                      // graphics API as the row that works. `lib/exportImage.ts`
                      // now refuses rather than downloading a transparent
                      // rectangle, and `sceneStill.ts` already failed safe. The
                      // prop is still honoured on the classic path below, which
                      // is every visitor while the flag is off.

                      // MULTISAMPLING, WHICH PHASE 5 DEFERRED TO HERE. On the
                      // node renderer `samples` is a CONSTRUCTOR value with no
                      // setter (`three.webgpu.js:61642`) and `PassNode` sizes
                      // its target from it, so the node post chain could not
                      // set its own the way EffectComposer does. This is the
                      // only place it can be decided.
                      //
                      // Keyed on the DISPLAY's density rather than on the
                      // tier's pixel-ratio ceiling, for the reason
                      // renderQuality.ts gives at length: samples stop earning
                      // their cost once the panel is already supersampling. The
                      // tier is not known yet at construction — the first render
                      // always carries the high profile — and on the weakest
                      // tier that means a device whose ratio will be capped at
                      // 1.5 gets the sample count for its native density, which
                      // is the CHEAPER one. Erring cheap for the weakest device
                      // is the right direction.
                      samples: composerMultisamplingFor(
                        typeof window === "undefined" ? 1 : window.devicePixelRatio
                      ),
                      forceWebGL: forcesWebGLBackend(rendererChoice),
                    });
                    renderer.toneMapping = rendererToneMappingForFamily({ isOceanFamilyScene });
                    await renderer.init();
                    // THE FIFTH GATE, and the only one `WebGPURenderer` does not
                    // cover itself. `GPUDevice.lost` stays pending for the
                    // device's whole life and resolves when the driver takes it
                    // away; there is no WebGL2 equivalent and nothing throws.
                    // Recovery is the remount above. See graphicsDeviceLoss.ts.
                    watchGraphicsDevice(renderer, () => {
                      setGraphicsDeviceLost(true);
                    });
                    return renderer;
                  }
                : {
                    preserveDrawingBuffer,
                    powerPreference: "high-performance",
                    toneMapping: rendererToneMappingForFamily({ isOceanFamilyScene }),
                  }
            }
            onCreated={disableShaderErrorCheckingInProduction}
            onPointerMissed={() => onSelectPlanet?.(null)}
          >
            <color attach="background" args={[backgroundColor]} />
            {parityHarness ? <ParityHarnessBridge request={parityHarness} /> : null}
            <ComposedFrameDrawerContext.Provider value={composedFrameDrawerReference}>
            {/* THE DOWNLOAD BUTTON AND EVERY TRANSITION DEPEND ON THIS ON THE
                NODE PATH. Its canvas reads back empty — 0 of 256 samples
                carrying alpha AND 0 of 256 carrying colour, on both backends —
                because `preserveDrawingBuffer` does not exist on
                `WebGPURendererParameters`, so the still is rendered rather than
                scraped. Not mounted on the classic path, whose canvas reads
                back correctly and is what every visitor has while the flag is
                off. Stage 0 of the graphics upgrade roadmap. */}
            {rendersWithNodePipeline ? <SceneStillBridge /> : null}
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
                    <ToneMapping> effect in the chain. The chain did not have
                    one, so for the ocean's whole life its tone curve was a
                    passthrough, `toneMappingExposure` was read by nothing, and
                    every linear value above 1 clipped flat to white — the cause
                    of every washed-out ocean frame reported so far.
                    Bypassing the chain restores the renderer's own ACES, makes
                    the per-depth exposure live again, and removes the need for
                    the hand-injected curve that stood in for it.

                    THE CHAIN NOW HAS A <ToneMapping>, and the ocean still does
                    not use it. Two reasons, and only the second one is about the
                    ocean: a composer pass is frame-wide, so it cannot read the
                    per-depth `toneMappingExposure` that IS this family's
                    adaptation curve (oceanRig.ts:313); and the ocean asks for no
                    bloom, no AO and no grade, so the chain would cost two
                    fullscreen buffers to deliver one curve it already has. The
                    fix that landed for the other three families is the right one
                    for them and would be a regression here. */}
                {/* WHICH CHAIN, AND THE CONDITION IS A CAPABILITY RATHER THAN A
                    PREFERENCE. §26 Phase 5 replaces `postprocessing` with
                    three.js's `RenderPipeline`, and that pipeline CANNOT run on
                    a `WebGLRenderer`: `PassNode` calls `getMRT`, `setMRT`,
                    `getOutputBufferType`, `getOutputRenderTarget` and
                    `contextNode`, none of which exist in three's WebGL build.
                    The composer has the mirror-image problem — `setRenderer`
                    reads `getContext().getContextAttributes()`, and a
                    `GPUCanvasContext` has no such method — so each chain runs on
                    exactly one renderer and neither can serve both.
                    So the renderer decides, and today that means every visitor
                    gets the composer while the harness's two node renderers get
                    the node chain. Both read their tuning from
                    postEffectsTuning.ts, and NodePostEffects.tsx carries the
                    divergences that cannot be tuned away. */}
                {isOceanFamilyScene ? null : rendersWithNodePipeline ? (
                  <NodePostEffects
                    postFX={scene?.postFX}
                    theme={scene?.theme}
                    ambientOcclusion={isForestFamilyScene}
                    postProcessingProfile={deviceRenderProfile.postProcessing}
                  />
                ) : (
                  <PostEffects
                    postFX={scene?.postFX}
                    theme={scene?.theme}
                    ambientOcclusion={isForestFamilyScene}
                    postProcessingProfile={deviceRenderProfile.postProcessing}
                  />
                )}
                <SceneReadySignal
                  onSceneReady={(graphicsBackend) => {
                    setLastReadyCanvasKey(canvasRemountKey);
                    // Reported here rather than on mount, because a canvas
                    // that mounted and never reached a frame is exactly the
                    // case the failure outcome exists to count — sending
                    // "rendered" on mount would report both as successes.
                    reportClientRender({
                      qualityTier: deviceRenderProfile.tier,
                      family: clientRenderFamilyForSceneType(scene?.sceneType),
                      outcome: CLIENT_RENDER_OUTCOME_RENDERED,
                      graphicsBackend
                    });
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
                maximumCameraHeightMetres={oceanCameraCeiling ?? undefined}
                minimumCameraHeightMetres={oceanCameraFloor ?? undefined}
                keyboardMoveEnabled={enableKeyboardMove}
                restingTarget={oceanCameraFraming?.target}
                introDurationSeconds={introDurationSeconds}
                introPhase={introPhase}
                introPoseSeed={seed}
              />
            </TerrainHeightSamplerContext.Provider>
            </PlanetPositionTrackerContext.Provider>
            </ComposedFrameDrawerContext.Provider>
          </Canvas>
          )}
        </div>
      </WebGLFailureBoundary>
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
