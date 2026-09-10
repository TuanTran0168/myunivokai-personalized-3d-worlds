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
/**
 * The port this suite's own production server listens on.
 *
 * 41300 by default, which is `npm run dev`'s port, so `reuseExistingServer`
 * attaches to a development server if one is already up. That is convenient
 * until it is wrong: the local compose stack serves this app on 41300 in dev
 * mode, and a dev server does not pick up a tailwind.config.ts change without a
 * restart — so a shoot taken beside a running stack can photograph classes that
 * do not exist yet and look like a layout bug in the code being reviewed. It
 * happened. `SHOOT_PORT=41399 npm run shoot` gets a build of its own instead.
 */
const APPLICATION_PORT = process.env.SHOOT_PORT ?? "41300";
const APPLICATION_ORIGIN = `http://127.0.0.1:${APPLICATION_PORT}`;

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
    baseURL: APPLICATION_ORIGIN,
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
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    // A THIRD project, on REAL GPU HARDWARE, and every part of this launch line
    // is a measurement rather than a preference — see §19.7 of
    // agent-system/research/webgpu-full-migration-feasibility-2026.md.
    //
    // The two projects above keep their SwiftShader pin, and should: their whole
    // value is that two runs differ only by the code between them. But
    // SwiftShader has no WebGPU at all, so a parity suite pinned to it cannot
    // see the backend it exists to compare. This project is the other trade —
    // the real driver, for the questions software rasterisation cannot answer.
    //
    // `channel: "chromium"` because Playwright's default `headless: true`
    // launches `chromium_headless_shell`, a DIFFERENT BINARY since 1.49 that
    // reports SwiftShader with zero flags and resolves `requestAdapter()` to
    // null. And `--disable-dawn-features=use_dxc` because the pinned full
    // Chromium enumerates the RTX 4060 and then fails `requestDevice()` with
    // `DynamicLib.Open: dxil.dll Windows Error: 87`. Remove either one and every
    // parity run silently photographs the WebGL fallback three times and reports
    // that all three backends agree.
    //
    // It costs exactly two adapter features, `shader-f16` and `subgroups`, both
    // measured and both unused by this app.
    {
      name: "webgpu",
      testMatch: /scene-parity\.spec\.ts/,
      // Four minutes, against the suite's 120 s default. A parity test renders
      // the same fixture through THREE renderers in one test, and each leg pays
      // its own renderer creation, lazy chunk, GLTF load and environment bake —
      // the forest leg alone can spend most of a minute on models. The 120 s
      // default timed the forest out mid-comparison, which reads exactly like a
      // renderer failure and is not one.
      timeout: 240_000,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        channel: "chromium",
        launchOptions: { args: ["--disable-dawn-features=use_dxc", "--force-device-scale-factor=1"] }
      }
    }
  ],
  webServer: {
    // The production build, not `next dev`. Dev mode double-renders under
    // StrictMode and serves unminified React, which is the difference this
    // upgrade is most likely to move — measuring it would compare two things at
    // once.
    //
    // `npm run shoot:serve`, not `npm run start`. `next start` REFUSES to serve
    // this app — `next.config.ts` sets `output: "standalone"` unconditionally
    // because that is what the deployed container runs, and Next answers
    // `next start` with *"does not work with output: standalone configuration"*.
    // So this command could never produce a server, and `reuseExistingServer`
    // hid that completely: with anything already listening on the port — a
    // `next dev` from the local compose stack, say — Playwright attached to it
    // and the suite measured the very thing the comment above forbids.
    // scripts/serveStandaloneBuild.mjs serves the standalone build the way
    // Dockerfile.prod does.
    command: `npm run build && npm run shoot:serve`,
    // NEXT_PUBLIC_PARITY_HARNESS is set HERE and nowhere else. It is what lets
    // `?parityRenderer=` choose a renderer and pin the animation clock.
    //
    // On `env` rather than inline in the command, for two reasons that both
    // bite: `NEXT_PUBLIC_*` is INLINED BY NEXT AT BUILD TIME, so prefixing only
    // `npm run start` would set it far too late and the harness would read
    // `undefined` in the very build it is meant to steer; and `VAR=x cmd` is not
    // portable to a Windows shell, which is where this suite runs.
    //
    // Gated on a build-time variable rather than on NODE_ENV deliberately: this
    // server IS a production build, so a NODE_ENV check would switch the harness
    // off in the only place it runs — while a real deployment, which never sets
    // the variable, cannot be steered onto an unshipped renderer by a query
    // string. See shared/parityHarness.ts.
    //
    // It is set for ALL THREE projects because they share one server, and that
    // is safe: absent the query parameter the harness resolves to `null` and the
    // canvas is byte-for-byte the code it was before. The one real difference is
    // an extra lazy chunk that nothing loads — `three/webgpu` is imported
    // dynamically precisely so it stays out of every visitor's bundle.
    //
    // PORT and HOSTNAME are here rather than as command flags for the same
    // portability reason: the standalone server reads them from the environment,
    // and `VAR=x cmd` is not a thing in the Windows shell this suite runs in.
    env: { NEXT_PUBLIC_PARITY_HARNESS: "1", PORT: APPLICATION_PORT, HOSTNAME: "127.0.0.1" },
    url: APPLICATION_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000
  }
});
