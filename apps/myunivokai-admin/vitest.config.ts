import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors apps/myunivokai-web/vitest.config.ts: pure-function unit tests
// only (lib/, and src/middleware.ts's exported pure helpers), no React
// Testing Library harness.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
