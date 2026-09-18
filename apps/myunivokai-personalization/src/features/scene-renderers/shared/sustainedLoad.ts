/**
 * WHAT A FRAME COSTS ONCE THE SCENE HAS SETTLED — THE ONE MEASUREMENT THIS
 * PROJECT HAS NEVER HAD.
 *
 * Stage 1 of `agent-system/plans/frontend/webgpu-graphics-upgrade-roadmap.md`,
 * and it is first in that plan for a reason: every graphics upgrade below it
 * makes a frame-time claim, and until this exists not one of them can be
 * checked. §26 Phase 11 says so in its own words — adaptive DPR and per-frame
 * instance upload "are NOT measured … both need a sustained-load harness this
 * one is the wrong shape for".
 *
 * # Why the parity harness is the wrong shape, and stays that way
 *
 * `parityHarness.ts` drives sixty fixed steps with `frameloop="never"`
 * **precisely so that it never measures a frame rate**: two images of the same
 * fixture have to be two images of the same moment, and a free-running loop
 * cannot promise that. That is the right trade for parity and it is not a
 * limitation to be fixed. This measures the other thing, and it reuses the same
 * machinery rather than adding a second way to drive the clock.
 *
 * # What is measured, and why it is stepped rather than free-running
 *
 * `advance(t)` under `frameloop="never"` runs a WHOLE frame — every `useFrame`,
 * the scene graph update, the post chain and the renderer's submit — so timing
 * the call is timing the frame's work. Driving it at a fixed cadence instead of
 * letting requestAnimationFrame set the pace buys two things a free-running
 * loop cannot:
 *
 *   - **the same work on every machine and every run.** A free-running loop
 *     hands each frame whatever delta the last one took, so a slow machine
 *     integrates further per frame and measures a different scene. Every
 *     number here is from the same sixty-per-second timeline.
 *   - **a percentile that means something.** The thing this app has to defend
 *     is a FLOOR — 60 fps, which is 16.7 ms — and a floor is broken by the
 *     worst frames, not the average. Fixed steps make the tail comparable.
 *
 * What it is NOT: a frame rate. A stepped loop cannot tell you the browser
 * sustained anything, only what each frame cost when asked for. Reading these
 * numbers as fps is the one mistake this file exists to make harder, which is
 * why nothing here is called `fps` and the reports carry milliseconds.
 */

/**
 * Frames stepped and thrown away before sampling starts.
 *
 * The first frames of any scene are not the scene: pipelines are still being
 * created, textures are uploaded on first use, and anything that eases toward
 * a target is still moving. §26 Phase 13 made the pipeline half of that a
 * bounded wait rather than a guess, but the uploads and the camera's opening
 * move are still in here. Sixty is one second of the timeline, which clears
 * both on every fixture measured so far.
 */
export const SUSTAINED_WARM_UP_FRAME_COUNT = 60;

/**
 * Frames actually timed. Three hundred is five seconds of the fixed timeline —
 * long enough for a 99th percentile to mean something (it is the worst three
 * frames rather than the worst one) and short enough that twelve of these fit
 * in a run.
 */
export const SUSTAINED_SAMPLE_FRAME_COUNT = 300;

/** The cadence the app's motion was authored against. */
export const SUSTAINED_FRAME_INTERVAL_SECONDS = 1 / 60;

/**
 * The frame budget the repo's performance bar implies.
 *
 * Not a threshold this module enforces — it is here so that a report can say
 * how many frames went over it, and so the number appears once rather than in
 * every caller. `agent-system/agents/frontend-agent.md`: "60 fps is the
 * minimum, quality-first, and the bar is never lowered for weaker hardware."
 */
export const SIXTY_FRAMES_PER_SECOND_BUDGET_MILLISECONDS = 1000 / 60;

export type SustainedLoadReport = {
  /** How many frames were timed. */
  frameCount: number;
  /** Milliseconds, sorted ascending — the raw material for everything below. */
  medianMilliseconds: number;
  ninetyFifthPercentileMilliseconds: number;
  ninetyNinthPercentileMilliseconds: number;
  worstMilliseconds: number;
  meanMilliseconds: number;
  /** How many of the timed frames cost more than a 60 fps budget. */
  framesOverBudget: number;
  /** Wall-clock across the whole sampled run, including the stepping overhead. */
  totalMilliseconds: number;
};

/**
 * The value at a percentile, by nearest rank on a sorted list.
 *
 * Nearest rank rather than interpolation on purpose: an interpolated p99 of 300
 * samples is a number that was never measured, and the whole point of the tail
 * here is that it is a real frame somebody's browser really spent.
 */
export function percentileOf(sortedMilliseconds: readonly number[], percentile: number): number {
  if (sortedMilliseconds.length === 0) {
    return 0;
  }
  const rank = Math.ceil((percentile / 100) * sortedMilliseconds.length);
  const index = Math.min(sortedMilliseconds.length - 1, Math.max(0, rank - 1));
  return sortedMilliseconds[index];
}

/** Turns a list of frame durations into the report a spec prints. */
export function summariseSustainedLoad(frameMilliseconds: readonly number[]): SustainedLoadReport {
  const sorted = [...frameMilliseconds].sort((left, right) => left - right);
  const total = frameMilliseconds.reduce((sum, milliseconds) => sum + milliseconds, 0);
  return {
    frameCount: frameMilliseconds.length,
    medianMilliseconds: percentileOf(sorted, 50),
    ninetyFifthPercentileMilliseconds: percentileOf(sorted, 95),
    ninetyNinthPercentileMilliseconds: percentileOf(sorted, 99),
    worstMilliseconds: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    meanMilliseconds: frameMilliseconds.length > 0 ? total / frameMilliseconds.length : 0,
    framesOverBudget: frameMilliseconds.filter(
      (milliseconds) => milliseconds > SIXTY_FRAMES_PER_SECOND_BUDGET_MILLISECONDS
    ).length,
    totalMilliseconds: total
  };
}

/**
 * The timestamps a sustained run steps through.
 *
 * Starts after the warm-up rather than at zero, so the sampled frames are a
 * continuation of the same timeline rather than a second scene that begins at
 * t=0 — anything that integrates would otherwise be measured twice from its
 * starting state, which is the mistake `ParityHarnessBridge` records under "a
 * pinned clock is not a pinned scene".
 */
export function sustainedFrameTimestamps(frameCount: number, startingFrameIndex = 0): number[] {
  const timestamps: number[] = [];
  for (let frame = 1; frame <= frameCount; frame += 1) {
    timestamps.push((startingFrameIndex + frame) * SUSTAINED_FRAME_INTERVAL_SECONDS);
  }
  return timestamps;
}
