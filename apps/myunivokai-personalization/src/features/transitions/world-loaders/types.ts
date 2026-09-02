import type { ComponentType } from "react";

/**
 * What one world family shows while it is being built.
 *
 * A loader is three things, and all three are the family's rather than the
 * app's: the ground the wait is painted on, the mark that moves on it, and the
 * sentence a screen reader is given instead of both. None of them is a spinner.
 * A spinner says "something is happening somewhere"; these say WHICH WORLD is
 * being built, which is the only interesting thing about this particular wait.
 *
 * EVERY MARK MUST ANIMATE WITH `transform` AND `opacity` AND NOTHING ELSE.
 *
 * This is not a style preference, it is the reason the loader exists at all.
 * The hold is shown across the exact window in which the destination scene is
 * mounting, and mounting a cold scene blocks the main thread for up to ~2.5
 * seconds (measured; see `UniverseCanvas.tsx`). Transform and opacity are the
 * two properties a browser can animate on the compositor without asking the
 * main thread for anything, so a mark built out of them keeps its frame rate
 * straight through that block. A mark that animated `width`, `top`,
 * `background`, or that ran off `requestAnimationFrame`, would freeze at
 * whatever pose it happened to be in — which is a worse thing to look at than
 * no loader at all, because a frozen loader reads as a crashed app.
 *
 * ADDING A FAMILY
 *
 * Write a component here, give it keyframes in the `world loaders` section of
 * globals.css, and add one entry to the record in `registry.ts`. The record is
 * typed `Record<WorldFamily, WorldLoader>`, so the compiler refuses to let a
 * new family exist without answering all three questions — the same guarantee
 * `RENDERER_IMPORTS_BY_FAMILY` gives for renderer chunks.
 */
export type WorldLoader = {
  /**
   * The classes that paint the ground behind the mark, in the family's own
   * colours, opaque. Opaque matters: the ground is what hides the destination
   * scene while it mounts, so the visitor never sees a half-built world.
   */
  groundClassName: string;
  /**
   * The mark itself. Rendered centred on the ground, and given no props — a
   * loader that needed to be told anything would be a loader that could be
   * wrong about it.
   */
  Mark: ComponentType;
  /**
   * What a screen reader is told while this is on screen. Written as a
   * statement of what is happening, not as a progress report: there is no
   * percentage to give and pretending otherwise would be a lie.
   */
  waitingLabel: string;
};
