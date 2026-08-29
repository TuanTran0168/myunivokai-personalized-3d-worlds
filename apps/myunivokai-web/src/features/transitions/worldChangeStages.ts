/**
 * The shape and the pacing of a world change: the old world genies out, the
 * arriving world's own loader holds the gap, the new world genies in.
 *
 * WHY THIS REPLACED A SWIPE
 *
 * The swipe it replaces slid one world off while the next arrived from the
 * other side, and there was nothing wrong with the gesture. What was wrong was
 * what it had to slide INTO. Mounting a scene the visitor has not opened before
 * blocks the main thread for up to ~2.5 seconds compiling shaders cold — the
 * number is measured, and `UniverseCanvas.tsx` documents at length why nothing
 * in this codebase can make it faster. A 420 ms gesture cannot cover a 2.5 s
 * wait, and the last attempt did not try to: it PARKED the outgoing still until
 * the destination was ready, so the freeze landed on a motionless frame instead
 * of on a moving one. Honest, and better than a stutter, but it still meant
 * seconds in which the visitor had clicked and nothing whatsoever had happened.
 *
 * So the wait stopped being something to hide. It gets its own phase, and that
 * phase belongs to the world being arrived at rather than to the one being
 * left: its ground colour, its loader, its name. The visitor is not waiting for
 * the app any more, they are watching a world being built.
 *
 * THE THREE PHASES, AND THE ONE RULE THAT MAKES THEM WORK
 *
 *   depart  620 ms   the outgoing still collapses into a slot on one edge
 *   hold    >= 420 ms, however long the destination needs
 *   arrive  620 ms   the destination unfolds back out of the same slot
 *
 * The rule: NOTHING THAT RUNS ON THE MAIN THREAD MAY OVERLAP THE MOUNT.
 *
 * Both genie halves are canvas `requestAnimationFrame` loops — a scanline warp
 * cannot be expressed as a CSS animation, because every row needs its own
 * interpolation. A rAF loop is a main-thread task, so it stops dead for the
 * whole compile block. That is precisely the failure the old swipe had, and
 * moving to a canvas would have reproduced it exactly.
 *
 * What fixes it is ORDERING, not technique. The destination is not mounted when
 * the departure starts; the page is still showing the world being left, which
 * has long since compiled everything it needs, so the main thread is free and
 * the departure plays clean. Only once the departure has finished does the page
 * commit the new scene (`onDeparted`), and by then the only thing on screen is
 * the hold — which is DOM and CSS, transform and opacity, and therefore runs on
 * the compositor and keeps its frame rate straight through a blocked main
 * thread. By the time the arrival starts, the compile is behind us and the main
 * thread is free again.
 *
 * That is the whole design: the two expensive animations are scheduled into the
 * two windows where the main thread is idle, and the window where it is not
 * gets an animation that does not need it.
 */

import { GENIE_DURATION_MILLISECONDS, type GenieRectangle } from "./genieWarp";
import type { WorldChangeDirection } from "./worldChangeDirection";

/**
 * How long each genie half runs.
 *
 * The same 620 ms the gallery card's reveal uses, and deliberately the same
 * constant rather than a second copy of the number: a world unfolding out of a
 * card and a world unfolding out of a transition slot are the same gesture seen
 * twice, and they would look like two different products the first time one of
 * them was tuned.
 */
export const WORLD_CHANGE_DEPART_MILLISECONDS = GENIE_DURATION_MILLISECONDS;
export const WORLD_CHANGE_ARRIVE_MILLISECONDS = GENIE_DURATION_MILLISECONDS;

/**
 * The shortest the hold is ever allowed to be, even when the destination is
 * ready the instant it is asked for.
 *
 * A warm switch — the visitor going back to a family they already opened once —
 * resolves in about 200 ms, and without a floor the loader would appear and
 * vanish inside a handful of frames. That reads as a flicker, which is worse
 * than no loader at all: the eye registers that something happened and gets no
 * chance to find out what. 420 ms is long enough for the mark to be seen as a
 * mark, and short enough that a warm switch still feels immediate.
 */
export const WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS = 420;

/**
 * The longest the hold will wait for a destination that never reports ready.
 *
 * `isDestinationReady` comes from `UniverseCanvas`'s `onSceneReady`, which fires
 * on the scene's first real frame. A renderer that throws, a chunk that fails to
 * load or a WebGL context that never comes back would leave that signal
 * permanently false, and the overlay covering the whole scene is the last thing
 * that should still be there when something has gone wrong underneath it. Well
 * past the worst cold compile ever measured here (~2.8 s), so a slow-but-fine
 * machine is never cut short by it.
 */
export const WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS = 8000;

/**
 * How long the loader takes to appear once the departure has cleared the frame,
 * and to get out of the way once the arrival starts.
 *
 * Asymmetric on purpose. Coming in it is the only thing on screen and can take
 * its time; going out it is being covered by the arriving world anyway, and a
 * loader still fading while a world unfolds over it is one thing too many.
 */
export const WORLD_LOADER_FADE_IN_MILLISECONDS = 260;
export const WORLD_LOADER_FADE_OUT_MILLISECONDS = 180;

/** Where the transition is up to. `idle` is the state before a request lands. */
export type WorldChangePhase = "idle" | "departing" | "holding" | "arriving";

/**
 * The slot the outgoing world collapses into and the incoming world unfolds
 * out of.
 *
 * Sized and placed as a fraction of the container rather than in pixels, so it
 * is the same gesture on a phone and on a 4K panel. It sits just OUTSIDE the
 * container's leading edge — `-6%` of the width — which is what makes the
 * collapse read as the world being drawn off the screen rather than being
 * sucked into a point in the middle of it, the same way macOS collapses a
 * window toward a dock that is off the edge of the window's own frame.
 *
 * `direction` decides which edge. Moving forward through the set of worlds
 * sends the old one off to the left, exactly as the swipe this replaces did, so
 * the ordering of the family picker and the variant list still reads in the
 * motion.
 */
export const WORLD_CHANGE_SLOT_WIDTH_RATIO = 0.1;
export const WORLD_CHANGE_SLOT_HEIGHT_RATIO = 0.16;
export const WORLD_CHANGE_SLOT_OVERHANG_RATIO = 0.06;

export function worldChangeSlot(
  container: GenieRectangle,
  direction: WorldChangeDirection
): GenieRectangle {
  const width = container.width * WORLD_CHANGE_SLOT_WIDTH_RATIO;
  const height = container.height * WORLD_CHANGE_SLOT_HEIGHT_RATIO;
  const overhang = container.width * WORLD_CHANGE_SLOT_OVERHANG_RATIO;
  // direction -1 is forward, and forward sends the world off the LEFT edge.
  const left =
    direction === -1
      ? container.left - overhang
      : container.left + container.width - width + overhang;
  return {
    left,
    // Vertically centred, not centred-on-the-title or anything cleverer: the
    // slot is a place, not a landmark, and the eye should read the collapse as
    // a direction rather than as a destination it has to find.
    top: container.top + (container.height - height) / 2,
    width,
    height
  };
}

/**
 * Is the hold allowed to end?
 *
 * Three answers rolled into one so the rule lives here rather than being spelled
 * out inside an animation frame: the destination has to be ready AND the floor
 * has to have passed, unless the ceiling has passed, in which case the
 * destination has had long enough and the transition proceeds regardless.
 */
export function isHoldFinished(elapsedMilliseconds: number, isDestinationReady: boolean): boolean {
  if (elapsedMilliseconds >= WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS) {
    return true;
  }
  return isDestinationReady && elapsedMilliseconds >= WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS;
}
