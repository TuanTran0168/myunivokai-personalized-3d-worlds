"use client";

import { useEffect, useRef, type RefObject } from "react";
import { REDUCED_MOTION_MEDIA_QUERY } from "@/lib/formRailCollapse";
import {
  SCENE_SWIPE_DURATION_MILLISECONDS,
  sceneSwipeCustomProperties,
  type SwipeDirection
} from "./swipeGesture";

/**
 * A still of the world being left, and which way it is going.
 *
 * The still is captured by the caller, not here, and it has to be: by the time
 * this component learns the world changed, React has already swapped the canvas
 * for the next one and the frame to keep is gone. `captureSceneStill` is called
 * in the handler that changes the world, one statement before the state update.
 */
export type SceneSwipeRequest = {
  still: HTMLCanvasElement;
  direction: SwipeDirection;
  /** Changes per swipe, so a second one restarts the effect rather than joining it. */
  token: number;
};

type SceneSwipeProps = {
  request: SceneSwipeRequest | null;
  /** The element holding the live <canvas>. It is the panel that slides IN. */
  sceneContainerReference: RefObject<HTMLDivElement | null>;
  /**
   * Called exactly once per request, whether the swipe played or was declined.
   * The caller clears the request with it, so a path that never calls back is a
   * scene container left parked off screen.
   */
  onFinished: () => void;
};

/** Safety net: if `animationend` never arrives, the swipe still has to end. */
const SCENE_SWIPE_TIMEOUT_MILLISECONDS = SCENE_SWIPE_DURATION_MILLISECONDS + 400;

/**
 * Reads the last drawn frame out of the scene container's canvas.
 *
 * Returns null rather than a blank rectangle when there is nothing to read. A
 * WebGL canvas hands back a cleared buffer unless it was created with
 * `preserveDrawingBuffer`, and sliding a transparent panel across the screen
 * reads as a flash of nothing rather than as a missing effect — the same trap
 * GenieReveal guards, checked the same way.
 */
export function captureSceneStill(sceneContainer: HTMLDivElement | null): HTMLCanvasElement | null {
  const sceneCanvas = sceneContainer?.querySelector("canvas");
  if (!sceneContainer || !sceneCanvas) {
    return null;
  }
  const containerBox = sceneContainer.getBoundingClientRect();
  if (containerBox.width < 1 || containerBox.height < 1) {
    return null;
  }
  // Capped at 2 for the same reason the genie caps it: past that the still
  // costs memory and fill rate for detail nobody resolves inside 420 ms.
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const still = document.createElement("canvas");
  still.width = Math.max(1, Math.round(containerBox.width * pixelRatio));
  still.height = Math.max(1, Math.round(containerBox.height * pixelRatio));
  const stillContext = still.getContext("2d");
  if (!stillContext) {
    return null;
  }
  stillContext.drawImage(sceneCanvas, 0, 0, still.width, still.height);
  const centreSample = stillContext.getImageData(
    Math.floor(still.width / 2),
    Math.floor(still.height / 2),
    1,
    1
  ).data;
  if (centreSample[3] === 0) {
    return null;
  }
  return still;
}

/**
 * Carries the outgoing world off screen while the live scene container arrives
 * from the other side.
 *
 * Driven by CSS KEYFRAMES, not by a requestAnimationFrame loop, and that is the
 * one decision here that matters most. This gesture runs at exactly the moment
 * the main thread is at its busiest — the next world is mounting, compiling
 * shaders and uploading textures behind it — and a JS loop writing
 * `style.transform` every frame is a main-thread task that gets queued behind
 * all of it. Measured on the world route, a single shader compile blocks for
 * over four seconds; a rAF-driven swipe would sit frozen for the whole of it.
 * A compositor animation keeps running through a blocked main thread, which is
 * the difference between a 420 ms gesture and a 420 ms freeze.
 *
 * Both halves are driven from here rather than one of them being left to the
 * page: they are one gesture, and two owners animating against the same clock
 * is how the two halves end up a frame apart. The still is drawn into a fixed
 * overlay pinned to the container's box, because the container itself is moving
 * and an overlay parented to it would move with it.
 *
 * The container's animation is set imperatively and ALWAYS cleared in cleanup,
 * including on an interrupted swipe. A transform left behind is a scene parked
 * off screen with no way back, which is worse than any transition is good.
 */
export function SceneSwipe({ request, sceneContainerReference, onFinished }: SceneSwipeProps) {
  const overlayReference = useRef<HTMLDivElement>(null);
  const stillHostReference = useRef<HTMLDivElement>(null);
  const onFinishedReference = useRef(onFinished);
  onFinishedReference.current = onFinished;

  useEffect(() => {
    function finish() {
      onFinishedReference.current();
    }
    if (!request) {
      return;
    }
    const sceneContainer = sceneContainerReference.current;
    const stillHost = stillHostReference.current;
    const overlay = overlayReference.current;
    if (!sceneContainer || !stillHost || !overlay) {
      finish();
      return;
    }
    if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      finish();
      return;
    }

    // Pin the overlay to the container's box, read BEFORE the container is
    // animated: getBoundingClientRect reports the transformed box, so reading
    // it later would chase the panel across the screen.
    const containerBox = sceneContainer.getBoundingClientRect();
    overlay.style.left = `${containerBox.left}px`;
    overlay.style.top = `${containerBox.top}px`;
    overlay.style.width = `${containerBox.width}px`;
    overlay.style.height = `${containerBox.height}px`;

    const still = request.still;
    still.style.position = "absolute";
    still.style.inset = "0";
    still.style.width = "100%";
    still.style.height = "100%";
    stillHost.replaceChildren(still);

    // Every number the keyframes use is written on from the TypeScript module,
    // so the stylesheet holds the SHAPE of the gesture and nothing else. One
    // keyframe pair serves both directions: the sign rides in as a value the
    // keyframes multiply by, rather than as a second set to keep in step.
    const customProperties = sceneSwipeCustomProperties(request.direction);
    for (const [property, value] of Object.entries(customProperties)) {
      stillHost.style.setProperty(property, value);
      sceneContainer.style.setProperty(property, value);
    }
    stillHost.classList.add("scene-swipe-out");
    sceneContainer.classList.add("scene-swipe-in");

    let hasFinished = false;
    function finishOnce() {
      if (hasFinished) {
        return;
      }
      hasFinished = true;
      finish();
    }
    sceneContainer.addEventListener("animationend", finishOnce);
    const timeoutId = window.setTimeout(finishOnce, SCENE_SWIPE_TIMEOUT_MILLISECONDS);

    return () => {
      window.clearTimeout(timeoutId);
      sceneContainer.removeEventListener("animationend", finishOnce);
      sceneContainer.classList.remove("scene-swipe-in");
      stillHost.classList.remove("scene-swipe-out");
      for (const property of Object.keys(customProperties)) {
        sceneContainer.style.removeProperty(property);
        stillHost.style.removeProperty(property);
      }
      stillHost.replaceChildren();
    };
  }, [request, sceneContainerReference]);

  if (!request) {
    return null;
  }
  return (
    <div
      ref={overlayReference}
      aria-hidden="true"
      // z-[5]: ABOVE the scene container, which carries no z-index of its own,
      // and BELOW the form rail and the world HUD, both of which sit at z-10.
      //
      // This was z-40 and it was wrong in a way only a screenshot showed. The
      // arriving half of the gesture is the scene container itself, which
      // passes under the rail; the leaving half was painting over it. So a
      // world slid off ACROSS the form the visitor was operating and the next
      // one slid in UNDERNEATH it — the same gesture on two different layers.
      // Both halves belong on the canvas's layer, and the chrome stays put over
      // the top of them, which is what makes the chrome read as chrome.
      className="pointer-events-none fixed z-[5] overflow-hidden"
    >
      <div ref={stillHostReference} className="absolute inset-0 origin-center" />
    </div>
  );
}
