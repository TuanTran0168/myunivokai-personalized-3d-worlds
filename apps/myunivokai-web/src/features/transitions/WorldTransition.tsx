"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { REDUCED_MOTION_MEDIA_QUERY } from "@/lib/formRailCollapse";
import type { WorldFamily } from "@/lib/types";
import { drawGenieSheet, genieRowCount } from "./genieSheet";
import type { GenieRectangle } from "./genieWarp";
import { captureSceneStill } from "./sceneStill";
import type { WorldChangeDirection } from "./worldChangeDirection";
import {
  WORLD_CHANGE_ARRIVE_MILLISECONDS,
  WORLD_CHANGE_DEPART_MILLISECONDS,
  isHoldFinished,
  worldChangeSlot,
  type WorldChangePhase
} from "./worldChangeStages";
import { WorldLoaderStage } from "./world-loaders/WorldLoaderStage";

/**
 * A still of the world being left, which way the change runs, and which world
 * is being arrived at.
 *
 * The still is captured by the caller, not here, and it has to be: by the time
 * this component learns the world changed, React has already re-rendered and
 * the frame worth keeping is gone. `captureSceneStill` is called in the handler
 * that changes the world, one statement before the state update.
 */
export type WorldTransitionRequest = {
  still: HTMLCanvasElement;
  direction: WorldChangeDirection;
  /** The family being arrived AT — whose ground and loader the hold wears. */
  family: WorldFamily;
  /** Changes per change, so a second one restarts the effect rather than joining it. */
  token: number;
};

type WorldTransitionProps = {
  request: WorldTransitionRequest | null;
  /** The element holding the live <canvas>. Its box is what the overlay covers. */
  sceneContainerReference: RefObject<HTMLDivElement | null>;
  /**
   * Whether the destination scene has rendered a real frame yet — the signal
   * `UniverseCanvas`'s `onSceneReady` already produces, threaded back down. The
   * caller must reset this to `false` in the same state update that starts the
   * transition; if it starts true the hold ends after its floor and the arrival
   * unfolds a world that has not drawn itself.
   */
  isDestinationReady: boolean;
  /**
   * Called exactly once per request, the moment the outgoing world has finished
   * leaving. THIS IS WHEN THE CALLER MOUNTS THE DESTINATION, and the ordering is
   * the reason the whole transition holds 60 fps — see the header comment in
   * `worldChangeStages.ts`. A caller that mounts the destination earlier gets its
   * departure animation run straight into a multi-second shader compile.
   *
   * Also fires if the transition is declined or interrupted, because the
   * destination has to end up on screen either way.
   */
  onDeparted: () => void;
  /**
   * Called exactly once per request, after `onDeparted`, when the arriving world
   * has fully unfolded. The caller clears the request with it, so a path that
   * never calls back is an overlay left covering the scene.
   */
  onFinished: () => void;
};

/**
 * Carries one world off, holds the gap in the arriving world's own colours, and
 * unfolds the next one into place.
 *
 * Three layers, and the order of them is the component:
 *
 *   1. the arriving family's GROUND — opaque, static, and the thing that hides
 *      the destination scene while it mounts;
 *   2. its LOADER MARK — DOM and CSS, transform and opacity only, so it keeps
 *      animating through the blocked main thread that is the entire reason
 *      there is a wait to fill;
 *   3. the WARP CANVAS — the two genie halves, drawn over both, and cleared to
 *      transparent in between so the hold shows through it.
 *
 * The canvas is only ever drawn on during the two halves, and both of those are
 * scheduled into windows where the main thread is known to be free: the
 * departure runs before the destination is mounted, the arrival after it has
 * finished mounting. `worldChangeStages.ts` explains why that ordering is the
 * whole design rather than an implementation detail.
 */
export function WorldTransition({
  request,
  sceneContainerReference,
  isDestinationReady,
  onDeparted,
  onFinished
}: WorldTransitionProps) {
  const overlayReference = useRef<HTMLDivElement>(null);
  const warpCanvasReference = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<WorldChangePhase>("idle");

  // Every one of these is read from inside a requestAnimationFrame loop that
  // must NOT be restarted when they change. `isDestinationReady` in particular
  // flips in the middle of the hold, and putting it in the dependency array
  // would tear down the loop and replay the departure at the exact moment the
  // destination finally became ready.
  const isDestinationReadyReference = useRef(isDestinationReady);
  isDestinationReadyReference.current = isDestinationReady;
  const onDepartedReference = useRef(onDeparted);
  onDepartedReference.current = onDeparted;
  const onFinishedReference = useRef(onFinished);
  onFinishedReference.current = onFinished;

  useEffect(() => {
    if (!request) {
      setPhase("idle");
      return;
    }
    const overlay = overlayReference.current;
    const warpCanvas = warpCanvasReference.current;
    const sceneContainer = sceneContainerReference.current;

    let hasDeparted = false;
    let hasFinished = false;

    // Arrow functions, not declarations: TypeScript only carries the null
    // checks below into a nested closure when the closure cannot have been
    // hoisted above them.
    const departOnce = () => {
      if (hasDeparted) {
        return;
      }
      hasDeparted = true;
      onDepartedReference.current();
    };
    const finishOnce = () => {
      // Never the other way round. The caller's two handlers are "mount the
      // destination" and "take the overlay away", and taking the overlay away
      // first would show the world that is still on screen — the one that was
      // supposed to have left.
      departOnce();
      if (hasFinished) {
        return;
      }
      hasFinished = true;
      onFinishedReference.current();
    };

    if (!overlay || !warpCanvas || !sceneContainer) {
      finishOnce();
      return;
    }
    const warpContext = warpCanvas.getContext("2d");
    if (!warpContext) {
      finishOnce();
      return;
    }
    // Re-bound after the check: `drawTransitionFrame` below is a function
    // declaration, so TypeScript has to assume it could be called before the
    // guard ran and drops the narrowing across it.
    const context = warpContext;
    if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      finishOnce();
      return;
    }

    // Pinned once. The overlay is fixed to the container's box in viewport
    // coordinates, and a viewport resize inside the ~1.7 s this runs for would
    // leave it stale — but re-reading the box every frame is a forced layout
    // every frame, which is a real cost paid every time to fix something that
    // essentially never happens and self-corrects the moment the overlay goes.
    const containerBox = sceneContainer.getBoundingClientRect();
    overlay.style.left = `${containerBox.left}px`;
    overlay.style.top = `${containerBox.top}px`;
    overlay.style.width = `${containerBox.width}px`;
    overlay.style.height = `${containerBox.height}px`;

    // Capped at 2 for the same reason the still is: past that the warp costs
    // memory and fill rate for detail nobody resolves inside 620 ms.
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    warpCanvas.width = Math.max(1, Math.round(containerBox.width * pixelRatio));
    warpCanvas.height = Math.max(1, Math.round(containerBox.height * pixelRatio));

    // Geometry in the overlay's own coordinates, not the viewport's: the canvas
    // covers exactly the container, so its origin IS the container's corner.
    const frame: GenieRectangle = {
      left: 0,
      top: 0,
      width: containerBox.width,
      height: containerBox.height
    };
    const slot = worldChangeSlot(frame, request.direction);
    const rowCount = genieRowCount(frame.height);
    const departingStill = request.still;

    const clearWarp = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, frame.width, frame.height);
    };

    let animationFrame = 0;
    let phaseStartTimestamp = 0;
    let currentPhase: Exclude<WorldChangePhase, "idle"> = "departing";
    let arrivingStill: HTMLCanvasElement | null = null;

    function drawTransitionFrame(timestamp: number) {
      if (phaseStartTimestamp === 0) {
        phaseStartTimestamp = timestamp;
      }
      const elapsed = timestamp - phaseStartTimestamp;

      if (currentPhase === "departing") {
        const progress = Math.min(1, elapsed / WORLD_CHANGE_DEPART_MILLISECONDS);
        clearWarp();
        drawGenieSheet(context, {
          source: departingStill,
          sourceWidth: departingStill.width,
          sourceHeight: departingStill.height,
          from: frame,
          to: slot,
          progress,
          rowCount
        });
        if (progress >= 1) {
          // Cleared rather than left holding the last frame: at progress 1 the
          // sheet is a sliver in the slot, and a sliver of the old world parked
          // on the edge of the new world's ground for the length of the hold
          // reads as a rendering fault.
          clearWarp();
          currentPhase = "holding";
          phaseStartTimestamp = timestamp;
          setPhase("holding");
          // The destination mounts HERE, with nothing on screen that needs the
          // main thread. Everything about the pacing depends on this line not
          // moving earlier.
          departOnce();
        }
        animationFrame = requestAnimationFrame(drawTransitionFrame);
        return;
      }

      if (currentPhase === "holding") {
        if (!isHoldFinished(elapsed, isDestinationReadyReference.current)) {
          animationFrame = requestAnimationFrame(drawTransitionFrame);
          return;
        }
        arrivingStill = captureSceneStill(sceneContainer);
        if (!arrivingStill) {
          // Nothing readable to unfold — the scene never drew, or the route
          // forgot `preserveDrawingBuffer`. Cut to it rather than warping a
          // transparent rectangle over the top of a world that is already
          // there and already correct.
          finishOnce();
          return;
        }
        currentPhase = "arriving";
        phaseStartTimestamp = timestamp;
        setPhase("arriving");
        animationFrame = requestAnimationFrame(drawTransitionFrame);
        return;
      }

      const arrivalSource = arrivingStill;
      if (!arrivalSource) {
        finishOnce();
        return;
      }
      const progress = Math.min(1, elapsed / WORLD_CHANGE_ARRIVE_MILLISECONDS);
      clearWarp();
      drawGenieSheet(context, {
        source: arrivalSource,
        sourceWidth: arrivalSource.width,
        sourceHeight: arrivalSource.height,
        from: slot,
        to: frame,
        progress,
        rowCount
      });
      if (progress >= 1) {
        // A hard swap, not a crossfade. The last frame of the warp places every
        // row exactly on the container's box, and the live canvas underneath is
        // showing the same world a few hundred milliseconds further into its
        // own idle motion — near enough identical that dissolving between them
        // would only add a dip.
        finishOnce();
        return;
      }
      animationFrame = requestAnimationFrame(drawTransitionFrame);
    }

    animationFrame = requestAnimationFrame(drawTransitionFrame);

    return () => {
      cancelAnimationFrame(animationFrame);
      // Deliberately NOT finishOnce. A cleanup that runs because a SECOND world
      // change arrived would clear the request that just replaced this one. But
      // the destination still has to be committed: the caller's own state has
      // already moved on, and leaving the canvas showing a world nothing points
      // at any more is the one outcome worse than an interrupted animation.
      departOnce();
    };
  }, [request, sceneContainerReference]);

  if (!request) {
    return null;
  }
  return (
    <div
      ref={overlayReference}
      // z-[5]: ABOVE the scene container, which carries no z-index of its own,
      // and BELOW the form rail and the world HUD, both of which sit at z-10.
      // The whole transition happens on the canvas's layer, and the chrome
      // stays put over the top of it — which is what makes the chrome read as
      // chrome rather than as part of the world that is leaving.
      className="pointer-events-none fixed z-[5] overflow-hidden"
    >
      <WorldLoaderStage family={request.family} isMarkVisible={phase === "holding"} />
      <canvas ref={warpCanvasReference} aria-hidden="true" className="absolute inset-0 h-full w-full" />
    </div>
  );
}
