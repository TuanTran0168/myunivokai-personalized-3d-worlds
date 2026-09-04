import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECURITY_RESPONSE_HEADERS,
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce
} from "./contentSecurityPolicy";

const TEST_GATEWAY_ORIGIN = "https://myunivokai-gateway.onrender.com";

function policy(options: { allowDevelopmentEval?: boolean } = {}): string {
  return buildContentSecurityPolicy({
    nonce: "a-test-nonce",
    gatewayOrigin: TEST_GATEWAY_ORIGIN,
    ...options
  });
}

function directive(name: string, builtPolicy = policy()): string {
  const found = builtPolicy.split("; ").find((entry) => entry.startsWith(`${name} `));
  if (!found) {
    throw new Error(`the policy has no ${name} directive: ${builtPolicy}`);
  }
  return found;
}

describe("the script-src directive", () => {
  // The reason this app has a middleware at all. Next injects its own inline
  // scripts to bootstrap hydration, so 'unsafe-inline' would be a policy that
  // permits exactly the injection it exists to stop.
  it("allows Next's inline scripts by nonce and never by 'unsafe-inline'", () => {
    expect(directive("script-src")).toContain("'nonce-a-test-nonce'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
  });

  // Most .glb models here carry KHR_draco_mesh_compression, and the DRACO
  // decoder is WebAssembly - WebAssembly.instantiate counts as script
  // evaluation. Without this, the nature family renders nothing.
  it("allows WebAssembly compilation and not general eval", () => {
    expect(directive("script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
  });

  it("adds 'unsafe-eval' only for next dev, which evaluates the React Refresh runtime", () => {
    expect(directive("script-src", policy({ allowDevelopmentEval: true }))).toContain("'unsafe-eval'");
  });

  // With 'strict-dynamic' present, supporting browsers ignore host sources in
  // script-src - so no later edit can quietly re-admit a third-party script
  // origin, and Next's programmatically inserted route chunks inherit trust
  // from the nonced bootstrap instead of needing to be enumerated.
  it("carries 'strict-dynamic' so inserted chunks inherit trust", () => {
    expect(directive("script-src")).toContain("'strict-dynamic'");
  });

  // The specific third party this replaced. drei's useGLTF defaults its DRACO
  // decoder path to a Google host; if that origin is ever back in the policy,
  // it means the self-hosted decoder was dropped and the CSP was widened to
  // paper over it rather than the other way round.
  it("names no third-party script origin, gstatic in particular", () => {
    expect(policy()).not.toContain("gstatic.com");
    expect(policy()).not.toContain("googleapis.com");
  });
});

describe("the rest of the policy", () => {
  it("permits connections only to this origin, the gateway, and the page's own blobs", () => {
    expect(directive("connect-src")).toBe(`connect-src 'self' ${TEST_GATEWAY_ORIGIN} blob:`);
  });

  // Found by the browser, not by reasoning: GLTFLoader turns a model's
  // embedded buffers and textures into Blob URLs and reads them back through
  // an ordinary fetch, which connect-src governs. Fourteen violations per
  // scene, invisible to every other check in the repo.
  it("allows the page to read its own blobs, which GLTFLoader needs", () => {
    expect(directive("connect-src")).toContain("blob:");
  });

  // DRACOLoader builds its worker from a Blob URL rather than a file. A blob
  // worker inherits the creating document's policy, so this widens what may
  // become a worker, not what a worker may do.
  it("allows a blob worker, for the DRACO decoder", () => {
    expect(directive("worker-src")).toContain("blob:");
  });

  // The world image export draws to a canvas and reads it back out as a blob.
  it("allows blob and data images, for the world export", () => {
    expect(directive("img-src")).toContain("blob:");
    expect(directive("img-src")).toContain("data:");
  });

  // Inline STYLE is unavoidable and a far smaller problem than inline script:
  // Next injects styles, and React Three Fiber sets style attributes on the
  // canvas host. A nonce cannot cover a style attribute, only a <style>
  // element, so nonce-ing styles would not remove 'unsafe-inline' anyway.
  it("accepts inline style, deliberately, and says so", () => {
    expect(directive("style-src")).toContain("'unsafe-inline'");
  });

  it("closes the directives an omitted default-src would not cover", () => {
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("form-action")).toBe("form-action 'self'");
  });

  it("starts from default-src 'self' so an unlisted fetch destination is denied", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
  });
});

describe("the nonce", () => {
  // A guessable nonce is the same as no nonce: an injected script could carry
  // it. This asserts the two properties that matter - it changes, and it is
  // long enough that guessing is not a strategy.
  it("differs on every call and is long enough not to be guessed", () => {
    const nonces = new Set(Array.from({ length: 32 }, () => createContentSecurityPolicyNonce()));
    expect(nonces.size).toBe(32);
    for (const nonce of nonces) {
      expect(nonce.length).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("the accompanying headers", () => {
  it("sets the three this app was missing entirely", () => {
    expect(SECURITY_RESPONSE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_RESPONSE_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_RESPONSE_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  // Strict-Transport-Security belongs to whatever terminates TLS. An
  // app-level copy on a preview deployment would pin a hostname the app does
  // not own.
  it("leaves Strict-Transport-Security to the platform", () => {
    expect(SECURITY_RESPONSE_HEADERS["Strict-Transport-Security"]).toBeUndefined();
  });
});

/**
 * The half of this policy that does not live in this module, and could not be
 * caught anywhere else.
 *
 * A nonce only matches if the HTML carrying it came from the same request that
 * produced the header, so `'strict-dynamic'` plus a nonce is a REQUIREMENT that
 * every document be rendered per request. Next prerenders by default, and a
 * prerendered page's scripts carry no nonce — at which point `'strict-dynamic'`
 * disables the `'self'` beside it and the browser refuses every application
 * chunk. That was `S3-CSP-001`: on a production build nothing hydrated, with
 * `tsc`, `next lint`, `next build` and every unit test green, and no page error
 * thrown anywhere.
 *
 * So the pairing is asserted rather than described. A comment in `layout.tsx`
 * cannot hold this — the failure is silent, and the only other thing that can
 * see it is `e2e/content-security-policy.spec.ts`, which CI does not run
 * (`.github/workflows/ci.yml` has no Playwright step). This is the same shape
 * as `oceanShaderSource.test.ts`: a lint over source text, because the real
 * verdict only exists in a browser.
 */
const ROUTE_SEGMENT_DIRECTORY = join(process.cwd(), "src/app");
const ROOT_LAYOUT_PATH = join(ROUTE_SEGMENT_DIRECTORY, "layout.tsx");
const FORCE_DYNAMIC_EXPORT = /export\s+const\s+dynamic\s*=\s*"force-dynamic"/;

/**
 * Route segment settings that put a page back into the build-time prerender,
 * which is the exact state that broke hydration. `revalidate` is here because
 * any numeric value makes a segment statically generated and then refreshed —
 * still HTML written without a nonce.
 */
const STATIC_RENDERING_EXPORTS = [
  /export\s+const\s+dynamic\s*=\s*"force-static"/,
  /export\s+const\s+dynamic\s*=\s*"error"/,
  /export\s+const\s+revalidate\s*=/
];

function routeSegmentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return routeSegmentFiles(entryPath);
    }
    return /^(page|layout|template)\.tsx$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("per-request rendering, which the nonce requires", () => {
  it("is what the policy asks for, so the premise of the tests below is stated rather than assumed", () => {
    const scriptSource = directive("script-src");
    expect(scriptSource).toContain("'strict-dynamic'");
    expect(scriptSource).toMatch(/'nonce-/);
  });

  it("is declared once, on the root layout, where every segment inherits it", () => {
    expect(readFileSync(ROOT_LAYOUT_PATH, "utf8")).toMatch(FORCE_DYNAMIC_EXPORT);
  });

  it("is not taken back by any route segment", () => {
    const offendingFiles = routeSegmentFiles(ROUTE_SEGMENT_DIRECTORY).filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return STATIC_RENDERING_EXPORTS.some((pattern) => pattern.test(source));
    });

    expect(
      offendingFiles,
      "a route segment asks to be prerendered again. Its HTML would then be written at build time with no nonce, and 'strict-dynamic' would make the browser refuse every application chunk on it - silently, with no page error. See S3-CSP-001."
    ).toEqual([]);
  });
});
