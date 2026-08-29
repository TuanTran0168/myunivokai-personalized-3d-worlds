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
   * Whether the destination scene has rendered a real frame yet — the same
   * signal `UniverseCanvas`'s `onSceneReady` already produces, threaded back
   * down. The caller must reset this to `false` in the SAME state update that
   * changes which scene is showing, before this component ever sees the new
   * `request`; if it starts true the parked phase below never happens.
   *
   * This is the fix for the freeze a first-ever visit to a scene like the
   * forest causes (documented at length in `UniverseCanvas.tsx`): compiling
   * ~44 shader programs cold can block the main thread for seconds, and nothing
   * in this codebase can make that faster (`compileAsync` was tried and
   * measured to do nothing on this project's driver). What was never necessary
   * was running the SWIPE through that freeze. See the parked-phase comment
   * below.
   */
  isDestinationReady: boolean;
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
 * Driven by CSS KEYFRAMES, not by a requestAnimationFrame loop, and that is one
 * of two decisions here that matter most. A JS loop writing `style.transform`
 * every frame is a main-thread task; a compositor animation is not, which
 * matters on a device with room to spare exactly as much as one without.
 *
 * The other is the PARKED PHASE below, and it exists because the first decision
 * turned out not to be enough. This used to start both halves moving the
 * instant a request arrived, on the theory that a compositor animation runs
 * through a blocked main thread regardless. It does — but starting it doesn't
 * un-block the thread that has to run the style recalculation that NOTICES the
 * new animation classes and hands them to the compositor in the first place.
 * Profiling a swipe into the forest showed why that matters: mounting the next
 * scene can cost 2.5-3 SECONDS of blocked main thread compiling shaders cold
 * (measured with the CPU sampler, not guessed — see `UniverseCanvas.tsx`), and
 * that block sits between the classes being added and the browser's next
 * chance to act on them. The result was not a smooth slide into a loading
 * scene; it was however much of the 420 ms gesture the browser could still fit
 * in once the block cleared, which could be all of it, none of it, or a
 * mid-flight snap to the final position — indistinguishable, to the person who
 * just clicked, from the app having glitched.
 *
 * So the two halves no longer move until `isDestinationReady` says the far
 * side has actually rendered something. Until then, the captured still sits
 * PARKED — drawn into place, animation classes withheld — which costs nothing
 * to hold: a still frame doing nothing is indistinguishable from the world it
 * is a picture of, sitting still. `UniverseCanvas`'s own loading veil already
 * treats a wait this way on purpose ("nothing animates during the wait...
 * reads as composure"); this just extends the same idea to the one thing on
 * screen that used to move regardless of whether the far side was ready to be
 * moved to.
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
export function SceneSwipe({ request, sceneContainerReference, isDestinationReady, onFinished }: SceneSwipeProps) {
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
    // it later would chase the panel across the screen. Re-read on every run
    // of this effect (including the one that flips isDestinationReady), which
    // is a deliberate no-op the common case and a correction the rare one
    // where the viewport was resized during the wait.
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
    //
    // Written unconditionally, even during the parked phase: they cost nothing
    // to have sitting on the element before the classes that read them exist,
    // and setting them here rather than inside startAnimating keeps this one
    // block the only place either element's inline style is touched.
    const customProperties = sceneSwipeCustomProperties(request.direction);
    for (const [property, value] of Object.entries(customProperties)) {
      stillHost.style.setProperty(property, value);
      sceneContainer.style.setProperty(property, value);
    }

    let hasStarted = false;
    let hasFinished = false;
    let timeoutId: number | null = null;

    // Arrow functions, not declarations: TypeScript only carries the null
    // checks above into a nested closure when the closure can't have been
    // hoisted above them.
    const finishOnce = () => {
      if (hasFinished) {
        return;
      }
      hasFinished = true;
      finish();
    };

    // The parked-to-moving handoff. Both classes go on together, same as
    // before — only WHEN has changed.
    const startAnimating = () => {
      if (hasStarted) {
        return;
      }
      hasStarted = true;
      stillHost.classList.add("scene-swipe-out");
      sceneContainer.classList.add("scene-swipe-in");
      sceneContainer.addEventListener("animationend", finishOnce);
      timeoutId = window.setTimeout(finishOnce, SCENE_SWIPE_TIMEOUT_MILLISECONDS);
    };

    if (isDestinationReady) {
      startAnimating();
    }
    // else: the still stays parked — drawn and positioned above, nothing more
    // — until a later run of this effect sees isDestinationReady flip true.

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      sceneContainer.removeEventListener("animationend", finishOnce);
      sceneContainer.classList.remove("scene-swipe-in");
      stillHost.classList.remove("scene-swipe-out");
      for (const property of Object.keys(customProperties)) {
        sceneContainer.style.removeProperty(property);
        stillHost.style.removeProperty(property);
      }
      stillHost.replaceChildren();
    };
  }, [request, isDestinationReady, sceneContainerReference]);

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
