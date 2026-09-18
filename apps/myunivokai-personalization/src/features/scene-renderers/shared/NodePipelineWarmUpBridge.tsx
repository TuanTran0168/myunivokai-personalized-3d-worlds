"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import {
  NODE_PIPELINE_WARM_UP_SKIPPED,
  forgetNodePipelineWarmUp,
  recordNodePipelineWarmUp,
  rendererCompilesPipelinesAsynchronously,
  scenePassForWarmUp,
  warmUpNodePipelines,
  type NodePipelineWarmUpReport
} from "./nodePipelineWarmUp";

/**
 * Builds this scene's pipelines OFF the main thread, before the first frame is
 * drawn. §26 Phase 13; `nodePipelineWarmUp.ts` has the measurement and the
 * three.js line numbers.
 *
 * # Why it is a component inside the canvas rather than a line in the `gl` factory
 *
 * `compileAsync(scene, camera)` walks the scene graph, and inside the factory
 * there is no scene graph: fiber awaits that factory before mounting a single
 * child, which is exactly what makes it the right place to load the node
 * modules and the wrong place to compile anything made out of them.
 *
 * # Why it is mounted INSIDE the Suspense boundary, last
 *
 * The forest and the ocean load GLB models, and a suspended tree has no meshes
 * in it. A warm-up that ran before the boundary resolved would compile the
 * handful of objects that were already there and report success, which is worse
 * than not running: `UniverseCanvas` would let the frames go on a promise that
 * covered almost nothing. Mounted last inside the boundary, its effect runs
 * after its siblings have mounted, which is the ordering React guarantees and
 * the only one this needs.
 *
 * # Why one of the two compiles goes through the post chain
 *
 * A family that mounts `NodePostEffects` does not draw its scene to the canvas —
 * it draws it into a `PassNode`'s render target, with an MRT for the normals GTAO
 * needs. Pipelines are cached per render context, so compiling against the
 * canvas and then drawing into a pass builds every pipeline twice: once here
 * and once in the first frame, which is the cost this file exists to remove.
 * `nodePipelineWarmUp.ts` has three's own line numbers for that.
 *
 * `expectsScenePass` is therefore not a hint — it is which of two different
 * compilations is correct for this family. The ocean, which renders straight to
 * the canvas with no chain, is the one that takes the renderer's own.
 *
 * # What it does NOT do
 *
 * It does not hold the frames itself. Holding them is `UniverseCanvas`'s
 * `frameloop` prop, because that is where a frame loop can be switched off, and
 * this component's whole contract with it is one callback. Keeping the decision
 * there also keeps it visible next to the harness's own `"never"`, which must
 * win — a harness that had its frames started by a warm-up would be driving a
 * clock someone else had already advanced.
 */
export function NodePipelineWarmUpBridge({
  expectsScenePass,
  onSettled
}: {
  /** Whether this family mounts the node post chain. See the header. */
  expectsScenePass: boolean;
  onSettled: (report: NodePipelineWarmUpReport) => void;
}) {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Held in a ref so the effect does not re-run when the parent re-renders with
  // a new closure. Re-running it would start a second `compileAsync` over a
  // scene the first one is still walking.
  const onSettledReference = useRef(onSettled);
  onSettledReference.current = onSettled;

  useEffect(() => {
    let thisCanvasIsStillMounted = true;
    const settle = (report: NodePipelineWarmUpReport) => {
      if (!thisCanvasIsStillMounted) return;
      recordNodePipelineWarmUp(report);
      onSettledReference.current(report);
    };

    if (!rendererCompilesPipelinesAsynchronously(renderer)) {
      // The classic renderer, which is every visitor while the rollout flag is
      // off. Settled immediately and synchronously: the caller is waiting for
      // this before it will draw, so an early return that reported nothing
      // would be a blank canvas for the entire population this change is not
      // about.
      settle({ outcome: NODE_PIPELINE_WARM_UP_SKIPPED, milliseconds: 0 });
      return;
    }

    forgetNodePipelineWarmUp();
    const compilePipelines = expectsScenePass
      ? async () => {
          const scenePass = await scenePassForWarmUp();
          return scenePass.compileAsync(renderer);
        }
      : () => {
          const compileAsync = (
            renderer as unknown as { compileAsync: (scene: unknown, camera: unknown) => Promise<unknown> }
          ).compileAsync;
          return compileAsync.call(renderer, scene, camera);
        };
    void warmUpNodePipelines(compilePipelines).then(settle);

    return () => {
      thisCanvasIsStillMounted = false;
    };
  }, [camera, expectsScenePass, renderer, scene]);

  return null;
}
