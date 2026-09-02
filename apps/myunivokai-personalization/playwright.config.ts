import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshots exist here for one reason: nothing else in this repo can see the
 * canvas. `npm test` runs pure functions, `tsc` checks types and `next build`
 * checks that the app compiles — and a scene that renders the wrong colour, the
 * wrong geometry or nothing at all passes every one of them. See
 * agent-system/evolution/frontend-modernization-research.md#the-blind-spot-nothing-in-ci-can-see-the-scene.
 *
 * These are NOT run by `npm test` and NOT run in CI. They are a before/after
 * instrument for a human, taken deliberately on either side of a dependency
 * change and compared BY EYE — `npm run shoot:baseline`, then the upgrade, then
 * `npm run shoot`. A pixel assertion would be worse than nothing here: WebGL
 * output differs across GPUs and drivers, so a red CI job would mean "different
 * machine" far more often than "broken scene", and a suite everyone learns to
 * ignore is not coverage.
 */
export default defineConfig({
  testDir: "./e2e",
  // One worker, no retries: these produce artefacts to look at, not a verdict
  // to act on, and two browsers competing for one software GL context is how
  // the artefacts stop being comparable.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:41300",
    // Software GL, not the host's driver. The whole value of these images is
    // that two runs on the same machine differ only by the code between them,
    // and a GPU that schedules work differently under load breaks exactly that.
    launchOptions: {
      // --enable-unsafe-swiftshader is REQUIRED, not optional. Chrome deprecated
      // the automatic software-WebGL fallback: without this flag it warns
      // "Automatic fallback to software WebGL has been deprecated" and hands
      // back a context that renders NOTHING. Every shot then comes out pure
      // black, for every family, and the suite keeps passing — the failure is
      // invisible because these tests assert nothing. Verified by sampling
      // pixels: rgb(0,0,0) across the whole canvas before the flag.
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-lcd-text",
        "--force-device-scale-factor=1"
      ]
    }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // 375px is the narrow end the world page actually reflows at: the HUD
    // stops being a pointer-transparent overlay and becomes a scrolling column.
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } }
  ],
  webServer: {
    // The production build, not `next dev`. Dev mode double-renders under
    // StrictMode and serves unminified React, which is the difference this
    // upgrade is most likely to move — measuring it would compare two things at
    // once.
    command: "npm run build && npm run start -- -p 41300 -H 127.0.0.1",
    url: "http://127.0.0.1:41300",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000
  }
});
