import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Minimal vitest setup for pure-function unit tests (lib/). The full
// @testing-library/react + CI wiring is FE refactor plan item 2.
export default defineConfig({
  // tsconfig.json sets `"jsx": "preserve"`, which is what Next's own compiler
  // wants and what Vite's transform would otherwise inherit. Under that setting
  // a .tsx is handed on with its JSX intact and fails import analysis as invalid
  // JS — so a plain data test that merely IMPORTS a module holding components
  // (the world-loader registry, for one) dies on syntax before it runs a single
  // assertion. Overridden here rather than in tsconfig.json, which the build
  // reads and this does not.
  //
  // `oxc`, not `esbuild`: Vite 8 does its TS/JSX transform with Oxc, and an
  // `esbuild` block here is accepted in silence and ignored.
  oxc: {
    jsx: {
      runtime: "automatic"
    }
  },
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
