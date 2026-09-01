"use client";

import type { CSSProperties } from "react";

/** Growth rings, each one a lap behind the last. */
const FOREST_RING_COUNT = 3;
const FOREST_RING_PERIOD_SECONDS = 2.4;

/** Motes drifting up through the rings, each on its own line and its own clock. */
const FOREST_MOTE_COUNT = 5;

/**
 * A sapling swaying inside growth rings that keep opening outward.
 *
 * The slowest of the three loaders, and deliberately: the forest is the one
 * world that must never look hurried, and a wait that reads as unhurried is a
 * wait that reads as shorter. A ring completes every 2.4 seconds against the
 * universe's 2 and the ocean's rising bubbles — near enough that the three feel
 * like one family, far enough that each one is recognisably its own world.
 *
 * The leaves are children of the stem rather than siblings, so they inherit its
 * sway instead of running two animations that would drift apart within a few
 * seconds of a hold that can last several.
 */
export function ForestLoaderMark() {
  return (
    <div className="world-loader-mark forest-loader">
      {Array.from({ length: FOREST_RING_COUNT }, (_, ringIndex) => (
        <span
          key={ringIndex}
          aria-hidden="true"
          className="forest-loader-ring"
          style={{
            animationDelay: `${(-(ringIndex * FOREST_RING_PERIOD_SECONDS) / FOREST_RING_COUNT).toFixed(3)}s`
          }}
        />
      ))}
      <span className="forest-loader-stem" aria-hidden="true">
        <span className="forest-loader-leaf forest-loader-leaf-left" />
        <span className="forest-loader-leaf forest-loader-leaf-right" />
        <span className="forest-loader-leaf forest-loader-leaf-tip" />
      </span>
      {Array.from({ length: FOREST_MOTE_COUNT }, (_, moteIndex) => (
        <span
          key={moteIndex}
          aria-hidden="true"
          className="forest-loader-mote"
          style={
            {
              // Spread across the mark rather than randomised: a fixed set of
              // lines is what makes this look like light through a canopy
              // rather than like noise.
              "--forest-mote-offset": `${(moteIndex / (FOREST_MOTE_COUNT - 1)) * 100}%`,
              animationDelay: `${(-moteIndex * 0.9).toFixed(2)}s`
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
