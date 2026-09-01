"use client";

import type { CSSProperties } from "react";

/**
 * Bubbles in flight at once. Fewer than the forest has motes, and larger: a
 * bubble is an object with an edge and a highlight, where a mote is a speck,
 * and seven objects is already a busy frame at this size.
 */
const OCEAN_BUBBLE_COUNT = 7;

/**
 * Where each bubble's column sits across the mark, and how long its own rise
 * takes, as a pair per bubble.
 *
 * Written out rather than generated from an index because the point is that no
 * two bubbles share a rhythm: evenly spaced columns on evenly spaced clocks
 * produce a marching row, which is the one thing rising bubbles never look
 * like. The periods are mutually awkward on purpose, so the pattern takes far
 * longer to repeat than any hold ever lasts.
 */
const OCEAN_BUBBLES: readonly { columnPercent: number; riseSeconds: number; sizeRatio: number }[] = [
  { columnPercent: 18, riseSeconds: 3.1, sizeRatio: 0.62 },
  { columnPercent: 40, riseSeconds: 4.3, sizeRatio: 1 },
  { columnPercent: 62, riseSeconds: 2.7, sizeRatio: 0.48 },
  { columnPercent: 78, riseSeconds: 3.7, sizeRatio: 0.82 },
  { columnPercent: 30, riseSeconds: 5.1, sizeRatio: 0.4 },
  { columnPercent: 55, riseSeconds: 3.4, sizeRatio: 0.7 },
  { columnPercent: 86, riseSeconds: 4.7, sizeRatio: 0.55 }
];

/**
 * Bubbles wobbling up toward a surface that is breathing.
 *
 * Rising is the one direction an ocean scene is always about — every one of
 * this family's moods is a depth, and every depth is measured from the surface
 * — so the wait moves the way the world reads. It is also the only one of the
 * three loaders whose motion has a destination: the universe's body goes round
 * forever and the forest's rings open into nothing, but a bubble is going
 * somewhere, and it arrives.
 *
 * Two nested elements per bubble because one element can only run one transform
 * animation: the outer carries the rise, the inner the sideways wobble, and the
 * ring and its highlight ride on the inner one.
 */
export function OceanLoaderMark() {
  return (
    <div className="world-loader-mark ocean-loader">
      <span className="ocean-loader-surface" aria-hidden="true" />
      {OCEAN_BUBBLES.slice(0, OCEAN_BUBBLE_COUNT).map((bubble, bubbleIndex) => (
        <span
          key={bubble.columnPercent}
          aria-hidden="true"
          className="ocean-loader-bubble"
          style={
            {
              left: `${bubble.columnPercent}%`,
              animationDuration: `${bubble.riseSeconds}s`,
              // Negative, so the frame opens with bubbles already spread up the
              // column instead of all seven setting off from the floor at once.
              animationDelay: `${(-bubbleIndex * 0.73).toFixed(2)}s`,
              "--ocean-bubble-size": `${(bubble.sizeRatio * 14).toFixed(1)}px`
            } as CSSProperties
          }
        >
          <span
            className="ocean-loader-bubble-drift"
            style={{ animationDuration: `${(bubble.riseSeconds / 3).toFixed(2)}s` }}
          />
        </span>
      ))}
    </div>
  );
}
