import type { Page } from "@playwright/test";

/**
 * WAITING FOR THE SCENE TO BE ON SCREEN, WHICH IS NOT THE SAME AS THE CANVAS
 * BEING VISIBLE.
 *
 * `UniverseCanvas` mounts its `<Canvas>` inside a wrapper held at `opacity-0`
 * until `SceneReadySignal` fires after the first drawn frame. **Playwright's
 * `toBeVisible` passes on an `opacity: 0` element** — opacity is a compositor
 * property, not a visibility one — so a spec that screenshots after
 * `toBeVisible` plus a fixed sleep is racing the renderer, and photographs the
 * PAGE through a transparent canvas whenever it loses.
 *
 * # It was always a race; `WebGPURenderer` is what made it lose
 *
 * `WebGLRenderer` reached its first frame inside those sleeps, so the race was
 * invisible for as long as it was the only renderer. Making the node renderer
 * the default on 2026-09-19 slowed the first mount on the WebGL2 backend this
 * suite's SwiftShader pin lands on — §26 Phase 13 measured 13.6 s of blocked
 * main thread against 3.6 s on the forest, on a REAL driver — and
 * `highlight-clipping` started reporting a look fault that was a capture fault.
 *
 * It read **3.17%** of the create preview clipped against a 1% ceiling, which
 * reads exactly like a tone curve that stopped being applied. It was not. The
 * two WORLD fixtures in the same spec read **0.19% and 0.09% on BOTH
 * renderers, identically**, and that pair is the proof: a renderer that clipped
 * differently would have moved all three. With this wait the create preview
 * reads **0.00%**, the same as the classic path.
 *
 * # Why `scene-baseline` does NOT use this, although it has the same race
 *
 * It was tried there and taken back out, and the reason is worth more than the
 * change would have been. `scene-baseline`'s shots are not only looked at —
 * `oceanFrameBudget.test.ts` READS them and measures their luma, so the moment
 * they are taken is a calibration. Adding this wait moves that moment later, past
 * the point where `introPhase` arms the camera's opening move, and the pictures
 * change:
 *
 *   `ocean-surface` luma   committed 0.257   ·   classic + this wait 0.563   ·   node + this wait 0.534
 *
 * **The classic renderer moves further than the node one.** So the drift is the
 * WAIT, not the renderer, and re-timing a calibrated instrument to fix a
 * failure it does not have would have been the wrong trade. Two things follow
 * and both are recorded rather than acted on:
 *
 *   - the committed ocean baselines are photographed before the reveal
 *     completes, so that budget is calibrated on partially-revealed frames
 *   - at the fully-revealed moment, `ocean-twilight` clips **7.4%** of the frame
 *     on the node renderer against 2% or less on the classic one, which is the
 *     ocean's recorded additive-compositing divergence appearing in a second
 *     instrument
 *
 * Re-baselining is a look decision with its own review, not a side effect of a
 * rollout.
 *
 * # Why the opacity is multiplied down the chain
 *
 * The fade lives on a wrapper, and which wrapper is an implementation detail no
 * spec should encode. Multiplying every ancestor's computed opacity answers
 * "can this be seen" without knowing where the transition was declared.
 */

/** Long, because the slowest legitimate wait is a forest first mount on the WebGL2 backend. */
export const SCENE_REVEAL_TIMEOUT_MILLISECONDS = 120_000;

/** Anything below this is a canvas still fading in, not one that has arrived. */
const REVEALED_OPACITY = 0.99;

/**
 * Resolves once the scene canvas is actually on screen.
 *
 * Throws by timeout rather than returning false, because every caller's next
 * line is a measurement and a measurement of a scene that never arrived is
 * worse than no measurement.
 */
export async function waitForSceneReveal(page: Page): Promise<void> {
  await page.waitForFunction(
    (revealedOpacity) => {
      // `canvas[data-engine]` rather than `canvas`: r3f stamps that attribute,
      // and a bare selector also matches WorldTransition's warp overlay, which
      // is what is left on the page when the failure boundary has removed the
      // scene.
      const canvas = document.querySelector("canvas[data-engine]");
      if (!canvas) {
        return false;
      }
      let effectiveOpacity = 1;
      let element: Element | null = canvas;
      while (element) {
        effectiveOpacity *= Number(window.getComputedStyle(element).opacity);
        element = element.parentElement;
      }
      return effectiveOpacity > revealedOpacity;
    },
    REVEALED_OPACITY,
    { timeout: SCENE_REVEAL_TIMEOUT_MILLISECONDS }
  );
}
