"use client";

import type { CSSProperties } from "react";

/**
 * How many bodies make up the trail behind the leading one.
 *
 * Every one of them is the same element on the same 2-second orbit, started a
 * few hundredths of a second earlier — which is what a trail IS. Eight is where
 * the trail stops reading as a smear of separate dots and starts reading as one
 * streak; more than that buys nothing the eye can resolve at this size.
 */
const UNIVERSE_TRAIL_LENGTH = 8;

/**
 * How far apart in the orbit two consecutive trail bodies sit, in seconds of
 * the lap. Small enough that the trail is continuous, large enough that it
 * covers a visible arc rather than piling up under the leading body.
 */
const UNIVERSE_TRAIL_SPACING_SECONDS = 0.042;

/**
 * A body completing an orbit, every two seconds.
 *
 * That is a progress bar with the bar taken away: the lap time is fixed and
 * legible, so the eye keeps its own count of how long this has been going
 * without ever being shown a percentage that would have to be invented. The
 * universe is the family whose whole scene is things going round other things,
 * so the wait is made out of the same motion the world itself is made of.
 *
 * Every layer here spins with `transform: rotate()` and nothing else — see the
 * contract in `types.ts` for why that is the one rule this component cannot
 * break.
 */
export function UniverseLoaderMark() {
  return (
    <div className="world-loader-mark universe-loader">
      {/* The thing being orbited. Never drawn as a disc: a hard circle in the
          middle would read as a second body and turn one clear motion into two
          things to look at. */}
      <span className="universe-loader-core" aria-hidden="true" />
      <span className="universe-loader-track" aria-hidden="true" />
      {Array.from({ length: UNIVERSE_TRAIL_LENGTH }, (_, trailIndex) => (
        <span
          key={trailIndex}
          aria-hidden="true"
          className="universe-loader-arm"
          style={
            {
              // Negative, so the arm starts already part-way round rather than
              // waiting its turn to set off.
              animationDelay: `${(-(trailIndex + 1) * UNIVERSE_TRAIL_SPACING_SECONDS).toFixed(3)}s`,
              opacity: (0.42 * (1 - trailIndex / UNIVERSE_TRAIL_LENGTH)).toFixed(3),
              "--universe-body-scale": (1 - trailIndex / (UNIVERSE_TRAIL_LENGTH + 4)).toFixed(3)
            } as CSSProperties
          }
        />
      ))}
      {/* The leading body, kept out of the loop above: it is the only one with a
          halo, and it is the one the eye actually follows. */}
      <span className="universe-loader-arm universe-loader-arm-lead" aria-hidden="true" />
    </div>
  );
}
