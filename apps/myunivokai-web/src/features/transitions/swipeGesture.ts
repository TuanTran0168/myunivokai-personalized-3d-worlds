/**
 * The whole-screen swipe that carries one world off and the next one on.
 *
 * Changing world used to be a dissolve: the canvas dropped to opacity 0, the
 * background colour showed for however long the next scene took to resolve, and
 * the new one faded up in the same place. Nothing about that said a different
 * world had arrived — it said the same window had been repainted. The gesture
 * this replaces it with is the one a phone uses for the next page and the one
 * every desktop uses for the next space: the screen you were on LEAVES, in a
 * direction, and the next one comes from where it was.
 *
 * PARALLAX is the whole thing, and getting it wrong is what makes a slide look
 * like two pictures glued to a strip of card. The arriving panel travels the
 * full width; the leaving one travels a fraction of it, dims and settles back.
 * That reads as the new world sliding OVER the old, which is depth, rather than
 * both sliding along a rail, which is a slideshow. Every platform that ships
 * this does the same — iOS moves the outgoing view at roughly a third.
 *
 * These numbers live here rather than in globals.css and are WRITTEN INTO the
 * element as custom properties by SceneSwipe, so the stylesheet consumes them
 * instead of holding a second copy. The animation itself has to be CSS (see
 * SceneSwipe for why the main thread cannot be trusted during this particular
 * 420 ms), and this is what keeps that from meaning two sources of truth.
 */

/**
 * Long enough to be a gesture, short enough not to be a wait.
 *
 * Shorter than the genie's 620 ms on purpose. The genie is an ARRIVAL and gets
 * to be looked at; this one sits between a visitor's click and the thing they
 * clicked for, and every millisecond of it is latency they did not ask for.
 * iOS pushes a view in about 350 ms and Android in about 300; 420 is that, plus
 * a little, because a whole 3D world is a bigger thing to move than a list.
 */
export const SCENE_SWIPE_DURATION_MILLISECONDS = 420;

/** How far the LEAVING panel travels, as a percentage of the box's own width. */
export const SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT = 32;

/** What the leaving panel has dimmed to, and shrunk to, by the time it is gone. */
export const SCENE_SWIPE_OUTGOING_OPACITY = 0.35;
export const SCENE_SWIPE_OUTGOING_SCALE = 0.94;

/**
 * An ease-OUT, not an ease-in-out: a swipe has already been decided by the time
 * it starts — the visitor has clicked — so it leaves at speed and settles,
 * rather than gathering itself first. This is the platform curve iOS uses for
 * the same gesture, not a new one invented here.
 */
export const SCENE_SWIPE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export type SwipeDirection = -1 | 1;

/**
 * Which way the swipe runs when moving between two positions in an ordered set
 * of worlds — the family picker's three cards, a world's list of variants.
 *
 * Moving DOWN the list sends the old world off to the left and brings the new
 * one in from the right, which is what a finger dragging right-to-left does.
 * Equal or unknown positions still return a direction rather than nothing: a
 * freshly regenerated variant has no position to compare against and still has
 * to arrive from somewhere, and forward is the honest default for something
 * that did not exist a moment ago.
 */
export function swipeDirectionBetween(fromPosition: number, toPosition: number): SwipeDirection {
  return toPosition < fromPosition ? 1 : -1;
}

/**
 * Whether a swipe between these two worlds is worth playing at all.
 *
 * The same key means the visitor re-picked what was already selected, and
 * sliding a world off to bring the identical world back reads as a glitch
 * rather than as a transition.
 */
export function isSceneSwipeWorthPlaying(fromKey: string, toKey: string): boolean {
  return fromKey.length > 0 && toKey.length > 0 && fromKey !== toKey;
}

/**
 * Exactly what SceneSwipe writes onto the two panels, and exactly what the
 * `scene-swipe-in` / `scene-swipe-out` keyframes read back out. One keyframe
 * pair serves both directions because the sign arrives as a value the keyframes
 * multiply by, rather than as a second set of keyframes to keep in step.
 */
export function sceneSwipeCustomProperties(direction: SwipeDirection): Record<string, string> {
  return {
    "--scene-swipe-direction": String(direction),
    "--scene-swipe-duration": `${SCENE_SWIPE_DURATION_MILLISECONDS}ms`,
    "--scene-swipe-travel": `${SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT}%`,
    "--scene-swipe-opacity": String(SCENE_SWIPE_OUTGOING_OPACITY),
    "--scene-swipe-scale": String(SCENE_SWIPE_OUTGOING_SCALE),
    "--scene-swipe-easing": SCENE_SWIPE_EASING
  };
}
