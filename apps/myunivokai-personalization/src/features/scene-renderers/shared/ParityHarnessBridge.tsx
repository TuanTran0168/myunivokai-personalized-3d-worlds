"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector3, WebGLCoordinateSystem, type Object3D } from "three";
import { lastNodePipelineWarmUp } from "./nodePipelineWarmUp";
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

    const harness = {
      backend,
      /**
       * How the node pipeline warm-up ended, or null while it is still running.
       *
       * §26 Phase 13. `first-mount-cost.spec.ts` polls this before advancing
       * the clock, because the two numbers it reports would otherwise be taken
       * across a boundary that moved: with the warm-up in flight the frames are
       * held, so \"sixty pinned frames\" would start measuring a wait rather than
       * a render. Reads the module record at CALL time rather than closing over
       * a value, so a harness registered before the warm-up settled still
       * answers with the settled one.
       */
      readPipelineWarmUp: () => lastNodePipelineWarmUp(),
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
