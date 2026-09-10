/**
 * THE TEST-ONLY SWITCHES THE PARITY HARNESS NEEDS, AND NOTHING ELSE.
 *
 * Phase 4 of agent-system/research/webgpu-full-migration-feasibility-2026.md.
 * §23.2 asks for three things the existing screenshot suite does not have, and
 * two of them can only come from inside the app:
 *
 *   (b) a PINNED ANIMATION PHASE, so two images of the same scene are two images
 *       of the same moment. `e2e/scene-baseline.spec.ts:72-79` records that
 *       freezing three's clock from outside "is not reliably possible", and it
 *       is right — but R3F's own manual frameloop is not freezing a clock, it is
 *       driving it. With `frameloop="never"`, `advance(t)` assigns
 *       `clock.elapsedTime = t` and hands `useFrame` a delta of
 *       `t - previous` (@react-three/fiber's `update`). A fixed sequence of
 *       timestamps therefore produces one exact phase, on any machine, at any
 *       speed, on either backend.
 *
 *   (c) a RENDERER CHOICE, so the same fixture can be photographed through
 *       `WebGLRenderer`, through `WebGPURenderer` on WebGPU, and through
 *       `WebGPURenderer` with `forceWebGL: true` — three images, two diffs, one
 *       machine, one driver. That isolates backend difference from machine
 *       difference, which is the objection `playwright.config.ts` raises against
 *       pixel assertions in the first place.
 *
 * WHY A BUILD-TIME FLAG AND NOT `NODE_ENV`. The shoot photographs a PRODUCTION
 * build on purpose — dev mode double-renders under StrictMode and serves
 * unminified React — so `process.env.NODE_ENV !== "production"` would switch
 * this off in the one place it is needed. `NEXT_PUBLIC_PARITY_HARNESS` is set by
 * the harness's own `webServer` command and by nothing else, so a real
 * deployment cannot be steered onto an unshipped renderer by a query string.
 *
 * Both switches are read from the URL rather than from scene config. The report
 * suggested "a test-only time parameter in scene config" and that would be
 * worse: scene config is stored data with a schema version, and a field that
 * only a test sets would travel to the database, the share pages and the
 * contract mirror. A query parameter reaches the same component and stops there.
 */

/**
 * The variable's name, for messages only. **Never use it as the lookup key.**
 *
 * Next inlines `NEXT_PUBLIC_*` at build time only where the reference is
 * statically analysable — `process.env.NEXT_PUBLIC_FOO`. Written as
 * `process.env[SOME_CONSTANT]` it cannot be inlined, so the browser bundle ships
 * `process.env` as `{}`, the lookup is `undefined`, and the harness is silently
 * off in exactly the build that set the variable. That is not hypothetical: the
 * first parity run failed all four tests on it, with `__parityHarness` never
 * appearing and a perfectly normal-looking page. `src/lib/gateway.ts` keeps the
 * same split for the same reason.
 */
const HARNESS_ENABLED_ENVIRONMENT_VARIABLE_NAME = "NEXT_PUBLIC_PARITY_HARNESS";

const RENDERER_QUERY_PARAMETER = "parityRenderer";
const PINNED_SECONDS_QUERY_PARAMETER = "paritySeconds";

/** Today's renderer, and the two the migration would introduce. */
export const PARITY_RENDERER_WEBGL = "webgl";
export const PARITY_RENDERER_WEBGPU = "webgpu";
export const PARITY_RENDERER_WEBGPU_FORCED_WEBGL = "webgpu-forcewebgl";

export type ParityRenderer =
  | typeof PARITY_RENDERER_WEBGL
  | typeof PARITY_RENDERER_WEBGPU
  | typeof PARITY_RENDERER_WEBGPU_FORCED_WEBGL;

const KNOWN_RENDERERS: readonly ParityRenderer[] = [
  PARITY_RENDERER_WEBGL,
  PARITY_RENDERER_WEBGPU,
  PARITY_RENDERER_WEBGPU_FORCED_WEBGL
];

/**
 * How many fixed steps the pinned clock takes to reach its target time.
 *
 * Sixty, because the step size is what the scene sees as `delta` and this app's
 * motion was authored against a 60 fps frame. One giant step to the target time
 * would hand every `useFrame` a delta of several seconds, and anything that
 * integrates rather than reads the clock — the camera rig's easing, a spring, a
 * drifter's position — would land somewhere no visitor will ever see.
 */
export const PINNED_CLOCK_STEP_COUNT = 60;

/** Where the pinned clock stops, when the harness does not say. */
export const DEFAULT_PINNED_SECONDS = 6;

export type ParityHarnessRequest = {
  renderer: ParityRenderer;
  pinnedSeconds: number;
};

function harnessIsEnabled(): boolean {
  // Statically analysable on purpose — see the note on
  // HARNESS_ENABLED_ENVIRONMENT_VARIABLE_NAME.
  return process.env.NEXT_PUBLIC_PARITY_HARNESS === "1";
}

/** The variable a build has to set to make the switches live. For messages. */
export function harnessEnvironmentVariableName(): string {
  return HARNESS_ENABLED_ENVIRONMENT_VARIABLE_NAME;
}

/**
 * What the harness is asking for, or `null` when it is not asking.
 *
 * `null` is the production answer and the default answer: absent the build flag,
 * absent the query parameter, or given an unknown renderer name, this returns
 * `null` and the canvas behaves exactly as it did before this file existed.
 * An unknown name is deliberately not an error — a typo in a test URL should
 * photograph the normal app rather than crash it, and the harness asserts which
 * backend it actually got (see `ParityHarnessBridge`) so a typo cannot pass
 * unnoticed either way.
 */
export function parityHarnessRequest(search: string | undefined): ParityHarnessRequest | null {
  if (!harnessIsEnabled() || !search) return null;
  const parameters = new URLSearchParams(search);
  const requestedRenderer = parameters.get(RENDERER_QUERY_PARAMETER);
  if (!requestedRenderer) return null;
  const renderer = KNOWN_RENDERERS.find((known) => known === requestedRenderer);
  if (!renderer) return null;
  const requestedSeconds = Number(parameters.get(PINNED_SECONDS_QUERY_PARAMETER));
  return {
    renderer,
    pinnedSeconds: Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds : DEFAULT_PINNED_SECONDS
  };
}

/**
 * The timestamps the pinned clock is driven through.
 *
 * Exported and unit-tested rather than inlined, because "deterministic" is a
 * property of this list and of nothing else in the harness: same list, same
 * phase, every run and every backend.
 */
export function pinnedClockTimestamps(pinnedSeconds: number, stepCount = PINNED_CLOCK_STEP_COUNT): number[] {
  return Array.from({ length: stepCount }, (_, stepIndex) => ((stepIndex + 1) * pinnedSeconds) / stepCount);
}
