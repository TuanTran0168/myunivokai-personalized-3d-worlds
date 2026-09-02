import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  CAMERA_POSE_WINDOW_KEY,
  type PublishedCameraPose
} from "../src/features/scene-renderers/shared/cameraPoseProbe";

/**
 * Reported: orbiting the camera in an ocean world fills the frame with a pale
 * layer that reads as staring into the sun. Turning the camera in seawater has
 * to show seawater.
 *
 * This drives the real preview and MEASURES the frame, because the fault is
 * invisible to every other kind of test here and an eye is the thing that
 * already missed one of these — the god-ray layer once clipped 100% of a reef's
 * pixels to white while the camera happened to point away from it.
 *
 * The cause was the backdrop dome: it was the one underwater layer not subject
 * to the medium, so it painted its gradient at full strength however much water
 * was in front of it. Bisected by hiding one layer at a time and re-measuring;
 * with the dome hidden the same frame measured 0.16 luma and 0.84 saturation
 * against 0.55 and 0.07 with it.
 */

/**
 * WHAT THIS FILE COULD NOT SEE UNTIL 2026-09-02, AND WHY IT NOW ASSERTS ON THE
 * CAMERA ITSELF.
 *
 * The frame statistics below are a real instrument for a real fault, and they
 * still are. What they cannot do is tell "the camera did not breach the
 * surface" from "the camera did not move at all" — both read as a perfectly
 * ordinary frame of water. So a control run of this spec with the camera fix
 * reverted passed, with numbers within noise of the fixed build (reef 0.285
 * luma / 0.632 saturation unfixed against 0.299 / 0.621 fixed), and the file
 * stayed green through the entire life of the bug it is named after.
 *
 * That control was then read as proof that the gesture never reached
 * `OrbitControls` at all. MEASURED AGAIN ON 2026-09-02, WITH THE CAMERA'S OWN
 * POSE PUBLISHED FROM INSIDE THE RIG (`cameraPoseProbe.ts`), THAT READING IS
 * WRONG. The input lands, in every ocean mood, on the production build:
 *
 *   world                resting radius → dragged pose            ceiling
 *   Glass Shallows       19.74 → 26.0, polar 1.449 → ~0, y 24.00  none (above water)
 *   Mesophotic Current   21.83 → 26.0, polar 1.607 → 1.143, y 15.159  15.159
 *   Reef Crest           21.10 → 26.0, polar 1.241 → ~0, y 21.635  24.737
 *   The Abyss            18.57 → 26.0, polar 1.217 → ~0, y 21.635  1773.27
 *
 * The wheel reaches the distance limit and the drag reaches the polar limit in
 * all four. Two other things the same measurement settled: the page carries
 * exactly ONE canvas, at the full viewport, so `page.locator("canvas").first()`
 * was never reading the wrong one; and the arithmetic the old note argued from
 * (an 18.65 m reef, so a drag to the pole would put the lens six metres into
 * the air) no longer describes the world — the shallows were sunk deeper, and
 * the reef's own ceiling now sits at 24.74 m with the pole three metres under
 * it.
 *
 * So the gap was never the input path. It was that a threshold on pixels is the
 * wrong instrument for a claim about a camera. Every test below now reads the
 * pose out of the running rig and asserts three things a screenshot cannot
 * carry: the wheel widened the orbit, the drag turned it, and the lens finished
 * at or under the ceiling that rig was given. `Mesophotic Current` is the world
 * where that last one bites — its drag stops dead ON the ceiling, 15.159 m,
 * with 0.000 m of headroom, which is the clamp from work item 1 doing its job
 * where a screenshot could only show more water.
 *
 * AND THE SAME PROBE CLOSED THE MIRROR. `Glass Shallows` is the create page's
 * above-water mood — `createOceanRig`'s `above` branch, so no seabed, no water
 * fog, no god rays, the sea drawn as a sheet seen from the sky — and it reported
 * no ceiling at all, because there is nothing over that lens. What it had
 * instead was nothing under it either: the orbit could dive straight through
 * its own sea into a scene with no water in it. It now carries a FLOOR, the
 * ceiling's reflection about the waterline (`oceanCameraFloorMetres`,
 * `maximumPolarAngleOverFloor`), and the drag stops dead on it — measured
 * -13.92245 m against a floor of -13.92245 m, with the polar angle held at
 * 2.047 rad instead of running to PI.
 *
 * The geometric invariant is still pinned in `oceanMath.test.ts` as well, where
 * it is checked across every world the generator can make, at every radius in
 * the envelope, without a GPU. This file is the end-to-end half: it proves the
 * clamp survives the real input path, the real rig and the real frame.
 */

const SHOT_DIRECTORY = "e2e/shots/ocean-look-down";
// Far enough to reach the polar limit in either direction. The first attempt at
// this used 260 and never left the band where the fault does not show.
const ORBIT_DRAG_PIXELS = 900;
// Enough wheel to be sitting on the distance limit rather than near it. The
// orbit starts at 20 m and tops out at 26, and OrbitControls dollies by a
// factor per notch, so a handful of generous notches is comfortably past it.
const ZOOM_OUT_WHEEL_STEPS = 12;
const ZOOM_OUT_WHEEL_PIXELS = 240;
// A frame the tone map has pushed to the top of its range with nothing left in
// it. Seawater is never this pale and never this grey.
//
// The floor is 0.18 rather than something tighter because an abyss is legitimately
// close to black, and saturation is a noisy measure down there — it measured 0.25
// after the fix and 0.05 before it, so the gap is what carries the test, not the
// threshold's precision. The luma ceiling is the other half of the same claim.
const MINIMUM_FRAME_SATURATION = 0.18;
const MAXIMUM_FRAME_LUMA = 0.45;
/**
 * The one world that needs its own, because it is legitimately the brightest
 * frame here: the clamp parks the lens ON the ceiling with the surface directly
 * overhead, in clear mesophotic water, looking up. Two runs measured 0.437 and
 * 0.454 — the scene is not deterministic frame to frame (the fauna move, the
 * sea moves), so 0.45 sits inside the spread and flakes.
 *
 * 0.52 is above the spread and still well under every reading the real fault
 * produced: the unfogged backdrop dome measured 0.55 at 0.07 saturation, and
 * the point-blank pale object measured 0.647. A threshold that cannot separate
 * those from a bright frame would be worth removing; this one still can.
 */
const MESOPHOTIC_MAXIMUM_FRAME_LUMA = 0.52;

// Proof the wheel landed, not a measure of how far it should go. The smallest
// gain measured across the four moods was 4.17 m (Reef Crest, 21.10 → 26.0), so
// a metre is comfortably inside the signal and far outside damping noise.
const MINIMUM_ZOOM_OUT_METRES = 1;
// Proof the drag landed. The smallest turn measured was 0.46 rad (Mesophotic
// Current, stopped early BY the ceiling clamp — the others ran the full 1.2 rad
// to the pole), and 0.1 rad is 5.7 degrees: far more than damping settles out,
// far less than any real gesture.
const MINIMUM_POLAR_CHANGE_RADIANS = 0.1;
// The clamp lands the lens exactly ON the bound (measured: 15.1589381768
// against a ceiling of 15.1589381768), so this covers float noise and nothing
// else. A breach is metres, not centimetres — the reverted-fix control put the
// lens six metres out.
const WATERLINE_TOLERANCE_METRES = 0.01;
// How many frames the rig must have published before the pose is read as
// settled. The scene's own first frame is not enough: the opening settle is
// still running, and under software GL the whole preview draws at about two
// frames a second, so this is a second or so of drawn scene rather than a
// fixed sleep hoping one arrived.
const SETTLED_PUBLISHED_FRAME_COUNT = 3;
// The cold browser's first ocean frame waits on a shader compile that measured
// several seconds under swiftshader — long enough that the first test of a run
// used to read the pose before the scene had drawn at all, while every test
// after it passed on the compiled program.
const FIRST_FRAME_TIMEOUT_MILLISECONDS = 60_000;

function shotDirectory(): string {
  mkdirSync(SHOT_DIRECTORY, { recursive: true });
  return SHOT_DIRECTORY;
}

type FrameStatistics = {
  meanLuma: number;
  blownPercentage: number;
  meanSaturation: number;
};

/** Reads the canvas back and reduces it to the three numbers that matter. */
async function measureFrame(page: Page): Promise<FrameStatistics> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("no canvas on the page");
    }
    const scratch = document.createElement("canvas");
    scratch.width = Math.min(480, canvas.width);
    scratch.height = Math.min(300, canvas.height);
    const context = scratch.getContext("2d");
    if (!context) {
      throw new Error("no 2d context for the readback");
    }
    context.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

    let lumaTotal = 0;
    let saturationTotal = 0;
    let blownCount = 0;
    const pixelCount = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      lumaTotal += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      saturationTotal += maximum === 0 ? 0 : (maximum - minimum) / maximum;
      if (data[index] >= 250 || data[index + 1] >= 250 || data[index + 2] >= 250) {
        blownCount++;
      }
    }
    return {
      meanLuma: lumaTotal / pixelCount,
      blownPercentage: (blownCount / pixelCount) * 100,
      meanSaturation: saturationTotal / pixelCount
    };
  });
}

/**
 * Where the lens is, as the rig itself reports it.
 *
 * Read through the same constant the rig publishes under, imported rather than
 * retyped: a probe whose two ends disagree about the key reads as "the scene
 * never drew", and a spec that cannot tell that from "the camera never moved"
 * is the thing this file is being fixed out of.
 */
async function readCameraPose(page: Page): Promise<PublishedCameraPose> {
  const pose = await page.evaluate(
    (key) => window[key as typeof CAMERA_POSE_WINDOW_KEY] ?? null,
    CAMERA_POSE_WINDOW_KEY
  );
  if (!pose) {
    throw new Error("the rig has published no camera pose — the scene never drew a frame");
  }
  return pose;
}

async function openOceanPreview(page: Page, moodLabel: RegExp): Promise<void> {
  await page.goto("/");
  await page.locator(".rail-scroll").waitFor();
  await page.getByRole("button", { name: /ocean/i }).first().click();
  await page.locator(".world-loader-ground").waitFor({ state: "detached", timeout: 60_000 });
  await page.locator("[data-form-section='mood']").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: moodLabel }).click();
  // The preview rebuild is debounced, then the scene has to draw a frame.
  await page.waitForTimeout(2500);
  // And the debounce is a guess about the app while THIS is the scene's own
  // answer: the rig publishes a pose per drawn frame, so waiting for a few of
  // them waits for the thing the sleep was standing in for.
  await page.waitForFunction(
    ([key, settledFrameCount]) => {
      const pose = window[key as typeof CAMERA_POSE_WINDOW_KEY];
      return pose !== undefined && pose.publishedFrameCount >= (settledFrameCount as number);
    },
    [CAMERA_POSE_WINDOW_KEY, SETTLED_PUBLISHED_FRAME_COUNT] as const,
    { timeout: FIRST_FRAME_TIMEOUT_MILLISECONDS }
  );
}

/**
 * Drags on the canvas until the orbit hits its polar limit.
 *
 * `directionSign` is the MOUSE direction, not the view direction, and the
 * mapping is the opposite of the one written here for two rounds: OrbitControls
 * moves the camera AROUND its target, and its `rotateUp` SUBTRACTS from the
 * polar angle, which is measured down from +Y. So dragging the mouse DOWN
 * RAISES the camera and swings the view down onto the target from above.
 *
 * That inversion is not a pedantic correction. It is the whole mechanism of the
 * fault this file is named after: "turning the camera down" is the gesture that
 * walks the lens UP, and in a shallow world it walked it out of the sea.
 */
async function orbitToPolarLimit(page: Page, directionSign: 1 | -1): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box to drag on");
  }
  const centreX = box.x + box.width * 0.7;
  const centreY = box.y + box.height * 0.5;
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  // Several steps: OrbitControls integrates movement, and one jump can be
  // swallowed as a click.
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(centreX, centreY + (directionSign * ORBIT_DRAG_PIXELS * step) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

/** Wheels the orbit out until it is against its distance limit. */
async function zoomToWidest(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box to scroll on");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < ZOOM_OUT_WHEEL_STEPS; step++) {
    await page.mouse.wheel(0, ZOOM_OUT_WHEEL_PIXELS);
  }
  await page.waitForTimeout(600);
}

test.describe("turning the camera in an ocean world", () => {
  // Both ends of the family's one axis, both ends of the orbit, and the world in
  // the middle where the ceiling is what stops the drag.
  //
  // The fault was reported on a reef and reproduced in the abyss too, and that
  // was read here as RULING OUT the camera crossing the waterline, on the
  // grounds that at 900 m it cannot reach it. The inference was wrong and it
  // cost two rounds of shader work: the same pale frame had two causes, and
  // fixing the abyss one (the backdrop dome, unfogged) left the reef one
  // standing. The reef's cause is geometric — the orbit lifts the lens out of
  // the water while the rig still believes it is submerged.
  //
  // `Mesophotic Current` is here for that second cause specifically: measured
  // 2026-09-02, it is the one preview world deep enough to have a ceiling and
  // shallow enough for the widest orbit to reach it, so its drag ends ON the
  // clamp rather than at the pole. Reef Crest and The Abyss keep the frame
  // honest; this one keeps the clamp honest.
  const ORBIT_THAT_RAISES_THE_LENS = { name: "one way", sign: 1 as const };
  const ORBIT_THAT_LOWERS_IT = { name: "the other", sign: -1 as const };
  for (const world of [
    {
      name: "Reef Crest",
      moodLabel: /reef crest/i,
      orbits: [ORBIT_THAT_RAISES_THE_LENS, ORBIT_THAT_LOWERS_IT],
      bound: "ceiling" as const,
      measuresTheMedium: true
    },
    // Raised only. Measured 2026-09-02: dragging this world's orbit DOWN walks
    // the lens onto the seabed and then ratchets the radius in from 26 m to
    // 4.3 m — the terrain clamp lifts camera and target together, the idle lerp
    // puts the target back on the framing, and the two together shorten the
    // offset a little every frame. The frame at the end of that is a single
    // pale object at arm's length (0.647 luma), which is a measurement of a
    // creature, not of the medium. The radius ratchet is a real fault and it is
    // recorded in the roadmap; asserting the medium's colour through it would
    // only make this file fail for the wrong reason.
    //
    // Raised, this is also the brightest frame the file measures — 0.437 luma
    // against the 0.45 ceiling, because the lens ends up ON the clamp with the
    // surface right above it. That margin is thin on purpose: it is the frame a
    // brightness regression would blow first.
    {
      name: "Mesophotic Current",
      moodLabel: /mesophotic current/i,
      orbits: [ORBIT_THAT_RAISES_THE_LENS],
      bound: "ceiling" as const,
      measuresTheMedium: true,
      maximumFrameLuma: MESOPHOTIC_MAXIMUM_FRAME_LUMA
    },
    {
      name: "The Abyss",
      moodLabel: /the abyss/i,
      orbits: [ORBIT_THAT_RAISES_THE_LENS, ORBIT_THAT_LOWERS_IT],
      bound: "ceiling" as const,
      measuresTheMedium: true
    },
    // The mirror, and the reason this file no longer only tests one side of the
    // waterline. `Glass Shallows` is the create page's above-water mood: its rig
    // takes `createOceanRig`'s `above` branch, which means no seabed, no water
    // fog, no god rays and the sea drawn as a sheet seen from the sky. An orbit
    // that dives under THAT does not arrive underwater, it arrives in a scene
    // with no water in it, looking up at the back of a wave mesh. Lowered only,
    // because that is the only direction with anything to hit, and its frame is
    // sky and sea rather than a medium — the seawater thresholds below would be
    // measuring daylight.
    {
      name: "Glass Shallows",
      moodLabel: /glass shallows/i,
      orbits: [ORBIT_THAT_LOWERS_IT],
      bound: "floor" as const,
      measuresTheMedium: false
    }
  ]) {
    for (const orbit of world.orbits) {
      test(`${world.name}, orbiting ${orbit.name}: shows seawater, not a wall of light`, async ({ page }) => {
        test.skip(test.info().project.name !== "desktop", "one viewport is enough for a render fault");
        await openOceanPreview(page, world.moodLabel);
        const restingPose = await readCameraPose(page);

        // Zoomed OUT first, which is the condition the owner reported and the
        // one this file was missing: the lift a tilt buys is the orbit radius
        // times the cosine of the polar angle, so the same drag that is
        // harmless at the resting distance puts the lens through the surface at
        // the wide end. Dragging at the resting radius alone measured clean
        // frames while the bug was live.
        await zoomToWidest(page);
        const zoomedPose = await readCameraPose(page);
        await orbitToPolarLimit(page, orbit.sign);
        const draggedPose = await readCameraPose(page);

        const frame = await measureFrame(page);
        const slug = `${world.name}-${orbit.name}`.toLowerCase().replace(/[^a-z]+/g, "-");
        await page.screenshot({ path: `${shotDirectory()}/${slug}.png` });
        console.log(`${world.name} ${orbit.name}`.padEnd(30), JSON.stringify(frame));
        console.log(`${world.name} ${orbit.name}`.padEnd(30), JSON.stringify(draggedPose));

        // The gesture landed. Asserted before anything about what the frame
        // looks like, because a clean frame from a camera that never moved is
        // the exact false pass this file used to hand back.
        expect(
          zoomedPose.orbitRadiusMetres,
          "the wheel did not reach the controls: the orbit is no wider than it started"
        ).toBeGreaterThan(restingPose.orbitRadiusMetres + MINIMUM_ZOOM_OUT_METRES);
        expect(
          Math.abs(draggedPose.polarAngleRadians - zoomedPose.polarAngleRadians),
          "the drag did not reach the controls: the orbit is at the same pitch it started at"
        ).toBeGreaterThan(MINIMUM_POLAR_CHANGE_RADIANS);

        // And it landed on the right side of the waterline. The bound is read
        // from the rig rather than solved here on purpose: the invariant worth
        // asserting is that the lens stayed inside the envelope THIS RIG WAS
        // GIVEN, and a test that computes its own is testing its own
        // arithmetic.
        if (world.bound === "ceiling") {
          expect(
            draggedPose.ceilingMetres,
            "this world used to be submerged and now reports no ceiling — the fixture changed, not the camera"
          ).not.toBeNull();
          expect(
            draggedPose.positionY,
            "the lens finished above the surface, where the rig is still built for water"
          ).toBeLessThanOrEqual((draggedPose.ceilingMetres ?? 0) + WATERLINE_TOLERANCE_METRES);
        } else {
          expect(
            draggedPose.floorMetres,
            "this world used to be above water and now reports no floor — the fixture changed, not the camera"
          ).not.toBeNull();
          expect(
            draggedPose.positionY,
            "the lens finished under the surface, where the rig is still built for air"
          ).toBeGreaterThanOrEqual((draggedPose.floorMetres ?? 0) - WATERLINE_TOLERANCE_METRES);
        }

        if (!world.measuresTheMedium) {
          return;
        }
        expect(frame.meanSaturation, "the frame has lost its colour to a pale layer").toBeGreaterThan(
          MINIMUM_FRAME_SATURATION
        );
        expect(frame.meanLuma, "the frame is a wall of light").toBeLessThan(
          world.maximumFrameLuma ?? MAXIMUM_FRAME_LUMA
        );
      });
    }
  }
});
