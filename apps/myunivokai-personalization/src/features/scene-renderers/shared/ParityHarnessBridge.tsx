"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { WebGLCoordinateSystem } from "three";
import {
  pinnedClockTimestamps,
  PINNED_CLOCK_STEP_COUNT,
  type ParityHarnessRequest,
  PARITY_RENDERER_WEBGL
} from "./parityHarness";

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

    const harness = {
      backend,
      requestedRenderer: request.renderer,
      pinnedSeconds: request.pinnedSeconds,
      stepCount: PINNED_CLOCK_STEP_COUNT,
      advanceToPinnedTime
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
  }, [advance, clock, renderer, request]);

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
