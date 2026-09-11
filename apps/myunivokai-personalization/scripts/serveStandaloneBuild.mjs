import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * SERVES THE PRODUCTION BUILD THE VISUAL SUITE SAYS IT MEASURES.
 *
 * `playwright.config.ts` argues at length that the shoot must photograph a
 * production build and not `next dev`, because dev mode double-renders under
 * StrictMode and ships unminified React. Its `webServer` command was
 * `npm run build && npm run start`, and `npm run start` is `next start`, which
 * REFUSES to serve this app:
 *
 *   "next start" does not work with "output: standalone" configuration.
 *   Use "node .next/standalone/server.js" instead.
 *
 * `next.config.ts` sets `output: "standalone"` unconditionally, because that is
 * what the deployed container runs (`Dockerfile.prod`). So the cold path had been
 * broken, and `reuseExistingServer` hid it: with a server already listening on
 * the port — a `next dev` from the local compose stack, say — Playwright attached
 * to that instead and the suite measured exactly the thing its own comment
 * forbids. Nothing failed; the images just came from somewhere else.
 *
 * This script serves the standalone build the way the container does, and the
 * layout is copied from `Dockerfile.prod:16-18` rather than invented: the
 * standalone bundle carries its own minimal `node_modules` and `server.js` but
 * NOT the static assets, so `public/` and `.next/static/` are placed beside it.
 * Without them the server answers HTML and 404s every script and image, which
 * looks like a blank page rather than a missing file.
 */

const STANDALONE_DIRECTORY = join(".next", "standalone");
const STANDALONE_SERVER_ENTRY = join(STANDALONE_DIRECTORY, "server.js");
const PUBLIC_DIRECTORY = "public";
const STATIC_DIRECTORY = join(".next", "static");

function copyAssetDirectory(source, destination) {
  if (!existsSync(source)) {
    return;
  }
  cpSync(source, destination, { recursive: true });
}

if (!existsSync(STANDALONE_SERVER_ENTRY)) {
  console.error(
    `serveStandaloneBuild: ${STANDALONE_SERVER_ENTRY} is missing. Run \`npm run build\` first — ` +
      "this script serves a build, it does not make one."
  );
  process.exit(1);
}

copyAssetDirectory(PUBLIC_DIRECTORY, join(STANDALONE_DIRECTORY, PUBLIC_DIRECTORY));
copyAssetDirectory(STATIC_DIRECTORY, join(STANDALONE_DIRECTORY, ".next", "static"));

// PORT and HOSTNAME are what the standalone server reads; Playwright passes them
// through `webServer.env` rather than inline in the command, because `VAR=x cmd`
// is not portable to the Windows shell this suite runs in.
const server = spawn(process.execPath, [STANDALONE_SERVER_ENTRY], {
  stdio: "inherit",
  env: process.env
});

server.on("exit", (code) => process.exit(code ?? 0));
