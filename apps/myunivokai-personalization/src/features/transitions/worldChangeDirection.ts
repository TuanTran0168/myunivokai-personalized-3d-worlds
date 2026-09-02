/**
 * Which way a world change runs, and whether it is worth playing at all.
 *
 * This is what survived of `swipeGesture.ts`. The parallax swipe it served is
 * gone — see `worldChangeStages.ts` for what replaced it and why — but the two
 * questions below outlived the gesture that first asked them, because they are
 * about the WORLDS rather than about the animation: which of them came first in
 * the set the visitor is moving through, and whether the visitor actually moved
 * at all.
 */

export type WorldChangeDirection = -1 | 1;

/**
 * Which way the change runs between two positions in an ordered set of worlds —
 * the family picker's three cards, a world's list of variants.
 *
 * Moving DOWN the list reads as forward, which is what a finger dragging
 * right-to-left does. Equal or unknown positions still return a direction
 * rather than nothing: a freshly regenerated variant has no position to compare
 * against and still has to go somewhere, and forward is the honest default for
 * something that did not exist a moment ago.
 */
export function worldChangeDirectionBetween(fromPosition: number, toPosition: number): WorldChangeDirection {
  return toPosition < fromPosition ? 1 : -1;
}

/**
 * Whether a transition between these two worlds is worth playing at all.
 *
 * The same key means the visitor re-picked what was already selected, and
 * taking a world away to bring the identical world back reads as a glitch
 * rather than as a transition.
 */
export function isWorldChangeWorthPlaying(fromKey: string, toKey: string): boolean {
  return fromKey.length > 0 && toKey.length > 0 && fromKey !== toKey;
}
