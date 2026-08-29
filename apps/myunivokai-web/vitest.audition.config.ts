import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// A SECOND vitest project, for the audio audition harness only.
//
// Separate from vitest.config.ts on purpose. The audition renders the real
// ambient graph offline and measures it, which needs `node-web-audio-api` — a
// development aid installed `--no-save`, not a dependency of the app or of CI.
// Held in its own config so `npm test` can never try to run it, and so the
// harness can still import the app's modules through the same `@` alias.
//
//   npm install --no-save node-web-audio-api
//   npx vitest run --config vitest.audition.config.ts --disable-console-intercept
//
// See notes/knowledge/frontend/ambient-audio-mechanism.md, "Auditioning it".
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.audition.ts"]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
