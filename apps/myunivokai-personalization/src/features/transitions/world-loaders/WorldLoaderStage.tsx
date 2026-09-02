"use client";

import type { CSSProperties } from "react";
import type { WorldFamily } from "@/lib/types";
import {
  WORLD_LOADER_FADE_IN_MILLISECONDS,
  WORLD_LOADER_FADE_OUT_MILLISECONDS
} from "../worldChangeStages";
import { worldLoaderForFamily } from "./registry";

type WorldLoaderStageProps = {
  family: WorldFamily;
  /**
   * Whether the mark is on screen. The ground is NOT faded with it — it stays
   * opaque for the whole life of this element, because its other job is hiding
   * a scene that is still mounting behind it, and a ground that dipped even to
   * 0.9 would show a half-built world through itself.
   */
  isMarkVisible: boolean;
};

/**
 * A world family's ground, its mark, and the one sentence that stands in for
 * both.
 *
 * Kept as its own component rather than inlined into `WorldTransition` so that
 * "what a family looks like while it is being built" is answerable in one place
 * — the transition is only the first thing that needed the answer.
 *
 * `role="status"` sits on a visually-hidden line rather than on the mark: the
 * mark is a picture of a wait and there is nothing useful to read out about it,
 * while a hold that can run for two and a half seconds absolutely does need to
 * announce itself to somebody who cannot see it happening.
 */
export function WorldLoaderStage({ family, isMarkVisible }: WorldLoaderStageProps) {
  const loader = worldLoaderForFamily(family);
  return (
    <>
      <div className={loader.groundClassName} aria-hidden="true" />
      <div
        className="world-loader-stage"
        data-mark-visible={isMarkVisible}
        aria-hidden="true"
        // Written on rather than hard-coded in the stylesheet, the same way the
        // swipe this replaced wrote its own timings: the pacing of a world
        // change lives in worldChangeStages.ts, and a second copy in globals.css
        // is two numbers that drift apart the first time one is tuned.
        style={
          {
            "--world-loader-fade-in": `${WORLD_LOADER_FADE_IN_MILLISECONDS}ms`,
            "--world-loader-fade-out": `${WORLD_LOADER_FADE_OUT_MILLISECONDS}ms`
          } as CSSProperties
        }
      >
        <loader.Mark />
      </div>
      <p className="sr-only" role="status">
        {loader.waitingLabel}
      </p>
    </>
  );
}
