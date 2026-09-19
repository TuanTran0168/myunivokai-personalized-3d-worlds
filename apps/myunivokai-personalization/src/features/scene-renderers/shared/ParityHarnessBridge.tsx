"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3, WebGLCoordinateSystem, type Object3D } from "three";
import { captureSceneStillAtNativeResolution } from "@/features/transitions/sceneStill";
import { sceneStillSource } from "./sceneStillCapture";
import {
  summariseSustainedLoad,
  sustainedFrameTimestamps,
  SUSTAINED_FRAME_INTERVAL_SECONDS,
  SUSTAINED_SAMPLE_FRAME_COUNT,
  SUSTAINED_WARM_UP_FRAME_COUNT,
  type SustainedLoadReport
} from "./sustainedLoad";
import {
  pinnedClockTimestamps,
  PINNED_CLOCK_STEP_COUNT,
  type ParityHarnessRequest,
  PARITY_RENDERER_WEBGL
} from "./parityHarness";

/**
 * How far apart two scene graphs are allowed to be and still be called the same
 * arrangement. Two backends running identical arithmetic agree exactly; this
 * exists so float noise in a matrix decomposition does not read as motion.
 */
const WORLD_POSITION_DECIMALS = 3;

/** How many of the outermost drawn objects to name when the checksums disagree. */
const FARTHEST_OBJECTS_TO_NAME = 6;

/**
 * WHAT IS ACTUALLY IN THE FRAME AND WHERE, so a divergence can be attributed to
 * the scene or to the renderer instead of guessed at from a picture.
 *
 * Two frames of the same fixture at the same pinned clock and the same camera
 * can still differ, and the two reasons are worlds apart: either the two
 * renderers drew the SAME arrangement differently — a shader, a colour space, a
 * blend — or they were handed DIFFERENT arrangements, which is not a renderer
 * question at all. A mean absolute error cannot tell those apart and neither can
 * looking at the images, which is how an afternoon goes into a wrong hypothesis.
 *
 * So this walks the graph the renderer is about to draw and reports the object
 * count and a checksum over every drawn object's world position. Equal
 * checksums mean the renderers were given the same scene.
 */
function summariseDrawnObjects(scene: Object3D) {
  const worldPosition = new Vector3();
  const farthest: { name: string; distance: number; position: string }[] = [];
  let drawnObjectCount = 0;
  let worldPositionChecksum = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    const drawable = object as { isMesh?: boolean; isPoints?: boolean; isSprite?: boolean; isLine?: boolean };
    if (!drawable.isMesh && !drawable.isPoints && !drawable.isSprite && !drawable.isLine) return;
    drawnObjectCount += 1;
    object.getWorldPosition(worldPosition);
    // Summed rather than hashed: the traversal order is the graph's order and is
    // the same on both paths, but a sum says "these are the same positions"
    // without also asserting "in the same order", and order is not the question.
    worldPositionChecksum += worldPosition.x + worldPosition.y + worldPosition.z;
    farthest.push({
      name: object.name || object.type,
      distance: worldPosition.length(),
      position: worldPosition
        .toArray()
        .map((component) => component.toFixed(WORLD_POSITION_DECIMALS))
        .join(",")
    });
  });
  return {
    drawnObjectCount,
    worldPositionChecksum: Number(worldPositionChecksum.toFixed(WORLD_POSITION_DECIMALS)),
    // A checksum says "the same or not". When the answer is "not", the next
    // question is always "which object", so the few furthest from the origin —
    // the ones a viewer would call the planets — are listed by name.
    farthestObjects: farthest
      .sort((left, right) => right.distance - left.distance)
      .slice(0, FARTHEST_OBJECTS_TO_NAME)
      .map((entry) => `${entry.name}@${entry.position}`)
  };
}

/**
 * The only thing the Playwright side can reach into, and it reports what it
 * ACTUALLY got rather than what was asked for.
 *
 * That distinction is the whole lesson of Phase 0 (§19.7 of the WebGPU
 * feasibility report): a `WebGPURenderer` whose `init()` rejects falls back to
 * WebGL silently, by design, and an unguarded parity run would then photograph
 * the WebGL path three times and report that all three backends agree. So
 * `backend` here is read off the renderer instance after it exists, and the spec
 * fails when it is not the one requested.
 *
 * Mounted inside `<Canvas>` and rendering nothing.
 */
export function ParityHarnessBridge({ request }: { request: ParityHarnessRequest }) {
  const renderer = useThree((state) => state.gl);
  const advance = useThree((state) => state.advance);
  const clock = useThree((state) => state.clock);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    // The frameloop is already "never" — `UniverseCanvas` passes it as a prop
    // when the harness is driving, which is the only way to guarantee that no
    // free-running frame ever touched this scene. See the note there.
    const backend = describeBackend(renderer, request);

    type CountingRenderInfo = {
      autoReset?: boolean;
      reset?: () => void;
      render?: Record<string, number>;
    };

    /**
     * `renderer.info` with automatic reset turned off.
     *
     * `info` resets per `render()` CALL, not per frame, so a chained frame
     * reports only its last pass unless the reset is taken over. The sustained
     * harness above learned the same thing the hard way and says so at length.
     */
    function countedRenderInfo(): CountingRenderInfo | undefined {
      const info = (renderer as unknown as { info?: CountingRenderInfo }).info;
      if (info) info.autoReset = false;
      return info;
    }

    /** What the frame just measured drew. `-1` where the backend does not say. */
    function readFrameCounts(info: CountingRenderInfo | undefined) {
      const counts = {
        drawCalls: info?.render?.drawCalls ?? info?.render?.calls ?? -1,
        triangles: info?.render?.triangles ?? -1
      };
      if (info) info.autoReset = true;
      return counts;
    }

    /**
     * Steps the pinned clock to its target and resolves once the frames are on
     * the GPU.
     *
     * `advance(t)` is synchronous and, under `frameloop="never"`, assigns
     * `clock.elapsedTime = t` and hands `useFrame` a delta of `t - previous`.
     * Sixty fixed steps therefore reproduce one exact phase — the thing
     * `scene-baseline.spec.ts` gave up on.
     */
    const advanceToPinnedTime = async () => {
      // Zero the clock first. `update()` derives `delta` from
      // `timestamp - clock.elapsedTime`, so the first step's delta depends on
      // whatever the clock already held — and a `Clock` constructed at mount
      // does not necessarily hold zero. Explicit is the only way this is a pure
      // function of the timestamp list.
      clock.elapsedTime = 0;
      clock.oldTime = clock.startTime;
      for (const timestamp of pinnedClockTimestamps(request.pinnedSeconds)) {
        advance(timestamp);
      }
      // A WebGPU frame is queued, not drawn, when `render()` returns. Draining
      // the queue is the difference between photographing the frame and
      // photographing whatever was in the swap chain before it — the same
      // mistake the Phase 0 probe made once and recorded.
      const queue = (renderer as { backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } } })
        .backend?.device?.queue;
      if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();
    };

    /**
     * Where the camera actually ended up, and what time the scene thinks it is.
     *
     * **A PINNED CLOCK IS NOT A PINNED SCENE, and this is what tells them
     * apart.** The clock pin guarantees both backends see the same sixty deltas;
     * it guarantees nothing about anything that INTEGRATES across them from a
     * starting state — `CameraRig`'s intro move accumulates its own elapsed
     * seconds, and its idle easing is `1 - exp(-k·dt)` toward a target. If the
     * two paths begin that integration from different states, every object in
     * the frame moves while the one at the camera's target stays put, and the
     * diff reads exactly like a renderer difference.
     *
     * So this is the first question to ask of any parity number that will not
     * explain itself: did the camera end up in the same place? One read, instead
     * of the bisect that question otherwise costs.
     */
    const readSceneState = () => ({
      elapsedTime: clock.elapsedTime,
      cameraPosition: camera.position.toArray(),
      cameraQuaternion: camera.quaternion.toArray(),
      ...summariseDrawnObjects(scene)
    });

    /**
     * WHAT A FRAME COSTS ONCE THE SCENE HAS SETTLED. Stage 1 of the graphics
     * upgrade roadmap, and `sustainedLoad.ts` carries the argument for why it
     * steps the clock rather than letting requestAnimationFrame set the pace.
     *
     * Two phases, and the split is the measurement. The warm-up frames are
     * stepped and thrown away — they hold the first-use texture uploads and the
     * camera's opening move, neither of which is what "a frame costs" means.
     * The sampled frames continue the SAME timeline rather than restarting it,
     * so nothing that integrates is handed its opening state twice.
     *
     * The GPU queue is drained once at the end rather than per frame. Draining
     * every frame would serialise the pipeline and measure a machine nobody
     * has; draining never would let work pile up behind the last timed frame
     * and report a cost the GPU had not yet paid. Once at the end puts any
     * backlog into `drainMilliseconds`, where it can be read rather than
     * hidden.
     */
    const measureSustainedFrames = async (): Promise<
      SustainedLoadReport & { drainMilliseconds: number; lastFrameDrawCalls: number; lastFrameTriangles: number }
    > => {
      clock.elapsedTime = 0;
      clock.oldTime = clock.startTime;
      for (const timestamp of sustainedFrameTimestamps(SUSTAINED_WARM_UP_FRAME_COUNT)) {
        advance(timestamp);
      }
      const queue = (renderer as { backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } } })
        .backend?.device?.queue;
      if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();

      const frameMilliseconds: number[] = [];
      for (const timestamp of sustainedFrameTimestamps(SUSTAINED_SAMPLE_FRAME_COUNT, SUSTAINED_WARM_UP_FRAME_COUNT)) {
        const startedAt = performance.now();
        advance(timestamp);
        frameMilliseconds.push(performance.now() - startedAt);
      }
      const drainStartedAt = performance.now();
      if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();
      const drainMilliseconds = performance.now() - drainStartedAt;

      // ONE MORE FRAME, DRAWN ONLY TO BE COUNTED — because a cheap frame and an
      // empty frame produce the same millisecond, and without this the table
      // cannot tell a 7x saving from a 7x omission.
      //
      // **`info` RESETS ITSELF PER `render()` CALL, NOT PER FRAME, AND THAT IS
      // WHAT MAKES THE NAIVE READ USELESS.** A family with a post chain issues
      // several `render()` calls per frame — the scene, then a fullscreen quad
      // per pass — so reading the counters afterwards reports the LAST pass and
      // nothing else. The first version of this did exactly that and reported
      // "1 triangle" for a forest: a fullscreen triangle, correctly counted, and
      // a completely wrong answer to the question. Switching `autoReset` off and
      // resetting once by hand makes the counters cover the whole frame.
      //
      // The two renderers do not agree on the field name either. Classic
      // `WebGLInfo` exposes `{ frame, calls, triangles, points, lines }` where
      // `calls` IS the draw count; the node `Info` exposes `drawCalls` for that
      // and uses `calls` for cumulative `render()` calls. Reading one name would
      // silently report the wrong quantity for one of the two legs.
      const info = (renderer as {
        info?: {
          autoReset?: boolean;
          reset?: () => void;
          render?: { calls?: number; drawCalls?: number; triangles?: number };
        };
      }).info;
      const previousAutoReset = info?.autoReset;
      if (info) {
        info.autoReset = false;
        info.reset?.();
      }
      advance((SUSTAINED_WARM_UP_FRAME_COUNT + SUSTAINED_SAMPLE_FRAME_COUNT + 1) * SUSTAINED_FRAME_INTERVAL_SECONDS);
      const accountedDrawCalls = info?.render?.drawCalls ?? info?.render?.calls ?? -1;
      const accountedTriangles = info?.render?.triangles ?? -1;
      if (info && previousAutoReset !== undefined) {
        info.autoReset = previousAutoReset;
      }

      return {
        ...summariseSustainedLoad(frameMilliseconds),
        drainMilliseconds,
        lastFrameDrawCalls: accountedDrawCalls,
        lastFrameTriangles: accountedTriangles
      };
    };

    /**
     * The still capture, as a PNG of exactly the size the caller asks for.
     *
     * Stage 0's only route to an assertion. `captureSceneStill` is reached from
     * click handlers in production and from nothing at all in a test, so
     * `scene-still-capture.spec.ts` would otherwise be photographing the canvas
     * and calling it evidence — which is the defect, not the fix.
     *
     * The caller passes the size because the thing this is compared against is
     * a Playwright screenshot of the canvas element, and two frames of
     * different sizes cannot be compared at all. Scaling here rather than in
     * the spec keeps the resize inside the browser's own resampler, which is
     * the same one the warp uses.
     */
    const captureSceneStillAsPngDataUrl = async (comparisonWidth: number, comparisonHeight: number) => {
      const sceneContainer = renderer.domElement.parentElement;
      const info = countedRenderInfo();
      info?.reset?.();
      const still = await captureSceneStillAtNativeResolution(sceneContainer);
      const captureCounts = readFrameCounts(info);
      if (!still) {
        return null;
      }
      const scaled = document.createElement("canvas");
      scaled.width = Math.max(1, Math.round(comparisonWidth));
      scaled.height = Math.max(1, Math.round(comparisonHeight));
      const scaledContext = scaled.getContext("2d");
      if (!scaledContext) {
        return null;
      }
      scaledContext.drawImage(still, 0, 0, scaled.width, scaled.height);
      return {
        dataUrl: scaled.toDataURL("image/png"),
        nativeWidth: still.width,
        nativeHeight: still.height,
        // Which of the two routes answered — the whole point of the spec.
        capturedFromRenderTarget: sceneStillSource() !== null,
        captureCounts
      };
    };

    /**
     * Draws the canvas again at the time it is already at, and counts it.
     *
     * **THE CONTROL FOR `scene-still-capture.spec.ts`, and it earned its place
     * by ruling out the first explanation.** When the still capture disagreed
     * with the canvas, the obvious reading was that the canvas was holding an
     * older frame — the harness pins a clock, not a scene, and `advance()` is
     * the only thing that repaints. A zero delta re-runs every `useFrame` with
     * nothing to integrate, so the scene cannot move, and the repaint measured
     * **0.03 of 255 against the screenshot taken before it**. The canvas is
     * current. Whatever the capture disagrees about, it is not staleness.
     *
     * Returning the counts is what turned that from a picture into a number:
     * the same frame drawn to the canvas and drawn into a capture target issues
     * a DIFFERENT number of draw calls, which is a fact about three rather than
     * about this app.
     */
    const redrawAtCurrentTime = () => {
      const info = countedRenderInfo();
      info?.reset?.();
      advance(clock.elapsedTime);
      return readFrameCounts(info);
    };

    const harness = {
      backend,
      redrawAtCurrentTime,
      captureSceneStillAsPngDataUrl,
      measureSustainedFrames,
      requestedRenderer: request.renderer,
      pinnedSeconds: request.pinnedSeconds,
      stepCount: PINNED_CLOCK_STEP_COUNT,
      advanceToPinnedTime,
      readSceneState
    };
    (window as unknown as { __parityHarness?: typeof harness }).__parityHarness = harness;

    return () => {
      // Only this instance's own registration, and that guard is load-bearing:
      // `UniverseCanvas` remounts the whole <Canvas> when `canvasRemountKey`
      // changes, which it does the moment the fixture's scene arrives. React
      // tears the old tree down before the new one mounts, so an unguarded
      // delete lets a dying bridge remove the live bridge's registration.
      const registered = (window as unknown as { __parityHarness?: unknown }).__parityHarness;
      if (registered === harness) {
        delete (window as unknown as { __parityHarness?: unknown }).__parityHarness;
      }
    };
  }, [advance, camera, clock, renderer, request, scene]);

  return null;
}

/**
 * Which backend is really behind this renderer.
 *
 * `WebGLRenderer` has no `backend` at all, so its absence is the identification
 * rather than a missing case. `WebGPURenderer` carries
 * `backend.isWebGPUBackend` / `backend.isWebGLBackend`, and its
 * `coordinateSystem` corroborates them — which matters because those two
 * coordinate systems are why Phase 1 found the two backends handing back
 * render-target rows in opposite order (§30.5).
 */
function describeBackend(renderer: unknown, request: ParityHarnessRequest): string {
  const candidate = renderer as {
    backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    coordinateSystem?: number;
    isWebGLRenderer?: boolean;
  };
  if (!candidate.backend) {
    return candidate.isWebGLRenderer === true && request.renderer === PARITY_RENDERER_WEBGL
      ? "WebGLRenderer"
      : "unknown-no-backend";
  }
  const coordinateSystem = candidate.coordinateSystem === WebGLCoordinateSystem ? "webgl-coords" : "webgpu-coords";
  if (candidate.backend.isWebGPUBackend === true) return `WebGPUBackend/${coordinateSystem}`;
  if (candidate.backend.isWebGLBackend === true) return `WebGLBackend/${coordinateSystem}`;
  return `unknown-backend/${coordinateSystem}`;
}
