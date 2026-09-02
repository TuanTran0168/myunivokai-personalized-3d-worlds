/**
 * The app's Content-Security-Policy, built here so it can be tested rather
 * than only deployed.
 *
 * # Why this is a security control and not hygiene
 *
 * The product session lives in cookies this app's own JavaScript writes, which
 * cannot be `httpOnly` — see `productSession.ts` for the whole argument. So an
 * XSS in this app can read the refresh token, and the only thing standing
 * between a script injection and a stolen session is this policy. The gateway
 * has set `default-src 'none'` for its JSON responses since Sprint 4; this app
 * set no headers at all until S8-IDENTITY-004, which is exactly the gap
 * §4.2 of agent-system/plans/architecture/end-user-identity-and-ownership.md
 * calls out.
 *
 * # Why a nonce, and why that forces middleware
 *
 * Next.js injects its own inline `<script>` tags to bootstrap hydration and to
 * stream flight data. A policy with `'unsafe-inline'` in `script-src` would
 * therefore "work" while permitting exactly the attack it exists to stop. A
 * per-request nonce is the only way to allow Next's own inline scripts and no
 * others, and a per-request value can only be generated per request — which is
 * why this app now has a `middleware.ts` at all.
 *
 * `'strict-dynamic'` accompanies the nonce so that scripts Next's runtime
 * inserts programmatically (route chunks, the lazily-loaded scene renderers)
 * inherit trust from the nonced bootstrap instead of each needing to be
 * enumerated. With `'strict-dynamic'` present, host-source allowlists in
 * `script-src` are ignored by supporting browsers, which is a feature here:
 * it means no future edit can quietly re-admit a third-party script origin.
 */

const NONCE_BYTE_LENGTH = 16;

/**
 * Directives whose values are the same in development and production.
 *
 * `wasm-unsafe-eval` is in `script-src` because the DRACO decoder is
 * WebAssembly: `WebAssembly.instantiate` counts as script evaluation, and
 * without it most of the nature family's models fail to decode. It permits
 * WASM compilation and nothing else — it is not `unsafe-eval`, and does not
 * allow `eval` or `new Function` on JavaScript source.
 *
 * `worker-src` admits `blob:` because `DRACOLoader` builds its worker from a
 * Blob URL rather than a file. A blob worker inherits the creating document's
 * policy, so this widens what may become a worker and not what a worker may do.
 *
 * `img-src` admits `blob:` and `data:` for the world image export, which draws
 * to a canvas and reads it back out as a blob.
 */
const SHARED_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Inline styles are unavoidable and are a much smaller problem than inline
  // script: Next injects them, and React Three Fiber and drei set style
  // attributes on the canvas host. A nonce cannot cover a style ATTRIBUTE,
  // only a <style> element, so nonce-ing styles would not remove
  // 'unsafe-inline' anyway.
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "media-src": ["'self'", "blob:"],
  "worker-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "manifest-src": ["'self'"]
};

/**
 * Everything the browser is allowed to open a connection to.
 *
 * The gateway origin is the only external one, and it is passed in rather than
 * read from the environment here so this function stays pure and testable —
 * and so a build pointed at a different gateway cannot end up with a policy
 * naming the wrong host.
 *
 * `'self'` is needed alongside it for Next's own route and flight requests.
 *
 * `blob:` is here because the browser demanded it, and it is worth recording
 * how: the first run of `e2e/content-security-policy.spec.ts` reported fourteen
 * `connect-src blocked blob` violations per scene. `GLTFLoader` turns a model's
 * embedded buffers and textures into Blob URLs and then reads them back through
 * `THREE.FileLoader`, which is an ordinary fetch and therefore governed by this
 * directive rather than by `img-src`. Nothing in the unit tests, the type
 * check, the lint or the build could see it.
 *
 * It also costs nothing: a `blob:` URL is minted by this page, is readable only
 * by this page, and reaches no network. Allowing it widens what the page may
 * read from itself, not where it may send anything.
 */
function connectSources(gatewayOrigin: string): string[] {
  return ["'self'", gatewayOrigin, "blob:"];
}

export type ContentSecurityPolicyOptions = {
  nonce: string;
  gatewayOrigin: string;
  /**
   * Development needs `'unsafe-eval'`: Next's dev server evaluates the React
   * Refresh runtime and webpack's HMR client that way, and there is no nonce
   * that covers `eval`. It is scoped to `next dev` only — a production build
   * that turned this on would silently give up the policy's main guarantee,
   * so the caller passes the flag rather than this module reading NODE_ENV and
   * hoping.
   */
  allowDevelopmentEval?: boolean;
};

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const scriptSources = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'"];
  if (options.allowDevelopmentEval) {
    scriptSources.push("'unsafe-eval'");
  }
  const directives: Record<string, string[]> = {
    ...SHARED_DIRECTIVES,
    "script-src": scriptSources,
    "connect-src": connectSources(options.gatewayOrigin)
  };
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * A fresh nonce per request.
 *
 * `crypto.getRandomValues` rather than `Math.random`: a guessable nonce is the
 * same as no nonce at all, because an injected script could simply carry it.
 * Base64 because that is what a CSP source expression accepts.
 */
export function createContentSecurityPolicyNonce(): string {
  const randomBytes = new Uint8Array(NONCE_BYTE_LENGTH);
  crypto.getRandomValues(randomBytes);
  return btoa(String.fromCharCode(...randomBytes));
}

/**
 * The other response headers this app was missing, kept next to the policy
 * they accompany rather than in a second place.
 *
 * `X-Frame-Options` duplicates `frame-ancestors 'none'` for browsers that
 * predate it; `Referrer-Policy` stops a share URL's path leaking to a
 * third-party site the visitor clicks through to; `X-Content-Type-Options`
 * stops a served asset being reinterpreted as script.
 *
 * No `Strict-Transport-Security` here: it is set by the platform that
 * terminates TLS, and an app-level copy on a preview deployment would pin a
 * hostname the app does not own.
 */
export const SECURITY_RESPONSE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

/**
 * The request header the nonce travels on, so a server component that has to
 * render a `<script>` can read the value the middleware generated. Next reads
 * the nonce out of the CSP header itself for its own scripts, so nothing in
 * this app needs to today — the header exists for the one that eventually does.
 */
export const CONTENT_SECURITY_POLICY_NONCE_HEADER = "x-content-security-policy-nonce";
