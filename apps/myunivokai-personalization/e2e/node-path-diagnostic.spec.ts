import { test, type Page } from "@playwright/test";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";

/**
 * THE STACKS `scene-parity.spec.ts` DELIBERATELY DOES NOT KEEP.
 *
 * That suite is a ratchet: every failure it records has to fit on one line of a
 * ledger, so it collects `error.message` and drops `error.stack`, which
 * Playwright puts on the same object. That is the right trade for a ratchet and
 * the wrong one for finding out where something went wrong — and it is why its
 * own ledger carries an entry reading *"forest on the node path throws
 * mid-frame, cause NOT located — Phase 6 should find it before porting the
 * forest"*, with `Cannot read properties of undefined (reading 'get')` and
 * nothing else.
 *
 * So this spec sits beside it rather than changing it, and **it asserts
 * nothing**. It renders each fixture on each node backend, catches whatever is
 * thrown, and prints the frames. Phases 6-8 each port shaders onto this path;
 * every one of them will throw something at some point, and the alternative to
 * this file is re-deriving how to get a stack out of the harness each time.
 *
 * Run it with `--project=webgpu`. The two SwiftShader projects have no WebGPU at
 * all, and `forceWebGL` on them would be measuring the software rasteriser.
 */

const PINNED_SECONDS = 6;
const HARNESS_READY_TIMEOUT_MILLISECONDS = 90_000;
const SCENE_ARRIVAL_MILLISECONDS = 8_000;
const DIAGNOSTIC_TIMEOUT_MILLISECONDS = 300_000;
const STACK_FRAMES_TO_PRINT = 24;
const CONSOLE_MESSAGE_CHARACTER_LIMIT = 400;
const SHOT_DIRECTORY = "e2e/shots/node-path-diagnostic";

/**
 * What the node builder says when it is handed a raw GLSL `ShaderMaterial`.
 *
 * Matched as a substring rather than reproduced in full: the sentence carries
 * the material's type name, and the count wants every refusal regardless of
 * which class was refused.
 */
const NODE_BUILDER_REFUSAL = "is not compatible";

const DIAGNOSTIC_FIXTURES = [
  { name: "forest-world", worldId: natureWorld.world.id, family: "nature" },
  { name: "universe-world", worldId: universeWorld.world.id, family: undefined },
  { name: "ocean-shallow", worldId: oceanShallowWorld.world.id, family: "ocean" }
] as const;

// `webgl` is here as the CONTROL. A node-path frame is only interpretable
// beside the frame it is supposed to match, and reading a mean absolute error
// without the baseline picture is how a whole afternoon goes into the wrong
// hypothesis.
const NODE_BACKENDS = ["webgl", "webgpu-forcewebgl", "webgpu"] as const;

type SceneState = {
  elapsedTime: number;
  cameraPosition: number[];
  cameraQuaternion: number[];
  drawnObjectCount: number;
  worldPositionChecksum: number;
  farthestObjects: string[];
};

type ParityHarnessWindow = Window & {
  __parityHarness?: {
    backend: string;
    advanceToPinnedTime: () => Promise<void>;
    readSceneState: () => SceneState;
  };
};

/** Enough decimals to see a real difference and not enough to see float noise. */
const POSE_DECIMALS = 4;

function describeSceneState(state: SceneState): string {
  const round = (component: number) => component.toFixed(POSE_DECIMALS);
  return [
    `clock ${round(state.elapsedTime)}`,
    `camera [${state.cameraPosition.map(round).join(", ")}]`,
    `facing [${state.cameraQuaternion.map(round).join(", ")}]`,
    `${state.drawnObjectCount} drawn`,
    `positions sum ${state.worldPositionChecksum}`
  ].join("  ·  ");
}

function describeFarthestObjects(state: SceneState): string {
  return state.farthestObjects.map((entry) => `    ${entry}`).join("\n");
}

async function serveWorldFixtures(page: Page) {
  const routes = [
    ["**/api/nature/**", natureWorld],
    ["**/api/universe/**", universeWorld],
    ["**/api/ocean/**", oceanShallowWorld]
  ] as const;
  for (const [path, world] of routes) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

function printStack(label: string, stack: string) {
  console.log(`${label}\n${stack.split("\n").slice(0, STACK_FRAMES_TO_PRINT).join("\n")}`);
}

for (const fixture of DIAGNOSTIC_FIXTURES) {
  for (const requestedRenderer of NODE_BACKENDS) {
    test(`${fixture.name} on ${requestedRenderer}: whatever it throws, with frames`, async ({ page }) => {
      test.setTimeout(DIAGNOSTIC_TIMEOUT_MILLISECONDS);

      // HOW MANY MATERIALS ARE STILL ON THE GLSL PATH, which is the only
      // progress signal a part-ported family has.
      //
      // A family's parity number cannot move until the LAST of its raw shaders
      // is ported, because the node path is all-or-nothing — so a nine-unit port
      // measured only by parity has one measurement at the end and none before
      // it. The node builder announces every refusal, once per material, and
      // counting them turns "some of the ocean is ported" into a number that
      // goes down.
      let refusedMaterialCount = 0;
      const pageErrors: { message: string; stack: string }[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push({ message: error.message, stack: error.stack ?? "(no stack)" });
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          if (message.text().includes(NODE_BUILDER_REFUSAL)) refusedMaterialCount += 1;
          console.log(`console.error: ${message.text().slice(0, CONSOLE_MESSAGE_CHARACTER_LIMIT)}`);
        }
      });

      await serveWorldFixtures(page);
      const familyParameter = fixture.family ? `family=${fixture.family}&` : "";
      await page.goto(
        `/worlds/${fixture.worldId}?${familyParameter}parityRenderer=${requestedRenderer}` +
          `&paritySeconds=${PINNED_SECONDS}`
      );

      // Twice, for the reason `scene-parity.spec.ts` documents at length: the
      // routed fixture arriving remounts the whole <Canvas>, so a harness read
      // before the wait belongs to a registration that no longer exists.
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });
      await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });

      console.log(`backend: ${await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.backend)}`);

      const advanceResult = await page.evaluate(async () => {
        try {
          await (window as ParityHarnessWindow).__parityHarness!.advanceToPinnedTime();
          return { threw: false, message: "", stack: "" };
        } catch (error) {
          const thrown = error as Error;
          return { threw: true, message: thrown.message, stack: thrown.stack ?? "(no stack)" };
        }
      });

      if (advanceResult.threw) {
        printStack(`\nadvanceToPinnedTime threw: ${advanceResult.message}\n`, advanceResult.stack);
      } else {
        console.log("advanceToPinnedTime completed without throwing");
      }

      // THE SECOND QUESTION, ASKED BEFORE THE PICTURE IS INTERPRETED: a pinned
      // clock is not a pinned scene. `CameraRig`'s intro move and its idle
      // easing both INTEGRATE across the sixty steps from whatever state they
      // start in, and a camera that lands somewhere else moves every object in
      // the frame except the one it is pointed at — which reads exactly like a
      // renderer difference and is not one.
      const sceneStateBeforeShot = await page.evaluate(() =>
        (window as ParityHarnessWindow).__parityHarness!.readSceneState()
      );
      console.log(`scene state: ${describeSceneState(sceneStateBeforeShot)}`);

      console.log(`outermost objects:\n${describeFarthestObjects(sceneStateBeforeShot)}`);

      console.log(`materials still on the GLSL path: ${refusedMaterialCount}`);

      console.log(`\npage errors: ${pageErrors.length}`);
      for (const pageError of pageErrors) {
        printStack(`\n--- ${pageError.message}`, pageError.stack);
      }

      // A FRAME TO LOOK AT, because a mean absolute error does not say WHAT is
      // wrong. `scene-parity.spec.ts` reports that the universe differs by 151
      // of 255; only the picture says the difference is a flooded screen rather
      // than a shifted one. Written under `e2e/shots/`, which this repo
      // deliberately does not gitignore.
      await page.screenshot({
        path: `${SHOT_DIRECTORY}/${fixture.name}-${requestedRenderer}.png`,
        animations: "disabled"
      });
    });
  }
}
