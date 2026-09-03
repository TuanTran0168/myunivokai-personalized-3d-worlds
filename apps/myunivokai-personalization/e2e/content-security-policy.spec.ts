import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * The one assertion suite in this folder that is a verdict rather than an
 * artefact to look at.
 *
 * S8-IDENTITY-004 adds this app's first Content-Security-Policy, and its second
 * scenario is "the CSP does not break the 3D scenes". Nothing else in the repo
 * can check that: `tsc`, `next build`, `next lint` and `npm test` all pass
 * against a policy that silently blocks the DRACO decoder, after which the
 * nature family renders no trees and no animals — a scene that is wrong in a
 * way only a browser can see.
 *
 * It is assertion-based, unlike the screenshot specs beside it, because a CSP
 * violation is not a matter of taste: the browser fires a
 * `securitypolicyviolation` event naming the directive it refused, so there is
 * an exact answer to compare against rather than an image to eye.
 */

/**
 * The family picker's own labels, which are not the family IDs. The nature
 * family's button says "Forest" - see the FAMILY_OPTIONS list in
 * src/app/page.tsx. Written out here rather than derived, because a rename of
 * the label should make this suite fail loudly rather than have it quietly
 * stop covering a renderer.
 */
const FAMILY_PICKER_LABELS = ["Universe", "Forest", "Ocean"] as const;

/** The label whose renderer loads the DRACO-compressed models. */
const DRACO_FAMILY_PICKER_LABEL = "Forest";

/** Long enough for the lazily-loaded renderer chunk, the model fetches and the
 * DRACO worker to have all happened. The models are the slow part and they are
 * the part under test. */
const SCENE_SETTLE_MILLISECONDS = 9_000;

type PageObservations = {
  policyViolations: string[];
  pageErrors: string[];
  requestedUrls: string[];
};

function observe(page: Page): PageObservations {
  const observations: PageObservations = { policyViolations: [], pageErrors: [], requestedUrls: [] };
  page.on("pageerror", (error) => observations.pageErrors.push(error.message));
  page.on("request", (request: Request) => observations.requestedUrls.push(request.url()));
  // Console is where Chrome reports a refusal in prose; the DOM event below is
  // the structured form. Both are collected because a violation inside a WORKER
  // reaches the console and not this document's event listener.
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") || text.includes("Refused to")) {
      observations.policyViolations.push(text);
    }
  });
  return observations;
}

async function listenForPolicyViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
}

async function readDocumentPolicyViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);
}

test.describe("the Content-Security-Policy", () => {
  test("is served on a document response, with a nonce and no inline script allowance", async ({ page }) => {
    const response = await page.goto("/sign-in");
    const policy = response?.headers()["content-security-policy"];

    expect(policy, "no Content-Security-Policy header on a document response").toBeTruthy();
    const scriptSource = policy!.split("; ").find((directive) => directive.startsWith("script-src "))!;
    expect(scriptSource).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(scriptSource).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  // The sign-in page is the one that must work under the policy for the sprint
  // to mean anything, and it is also the simplest: if Next's own hydration
  // bootstrap were blocked, nothing on it would be interactive.
  test("leaves the sign-in form hydrated and interactive", async ({ page }) => {
    await listenForPolicyViolations(page);
    const observations = observe(page);

    await page.goto("/sign-in");
    // Submitting empty is handled entirely client-side, so a response proves
    // hydration ran - which proves the nonced bootstrap script was allowed.
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address and password.")).toBeVisible();

    expect(await readDocumentPolicyViolations(page)).toEqual([]);
    expect(observations.policyViolations).toEqual([]);
    expect(observations.pageErrors).toEqual([]);
  });

  // The sign-up form gained a display-name field (S8-IDENTITY-019), and the
  // account page it points at now renders a world of its own behind the form
  // (S8-IDENTITY-020). Both are asserted because the create page's own
  // hydration is proven by the renderer tests below, and these two are not.
  test("leaves the sign-up form hydrated, display name and all", async ({ page }) => {
    await listenForPolicyViolations(page);
    const observations = observe(page);

    await page.goto("/sign-up");
    await page.getByPlaceholder("e.g. Neo").fill("Neo");
    // Submitting with a name and nothing else is handled client-side, so a
    // response proves the nonced bootstrap ran.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your email address and password.")).toBeVisible();

    expect(await readDocumentPolicyViolations(page)).toEqual([]);
    expect(observations.policyViolations).toEqual([]);
    expect(observations.pageErrors).toEqual([]);
  });

  test("renders the account page's signed-out state without violating the policy", async ({ page }) => {
    await listenForPolicyViolations(page);
    const observations = observe(page);

    await page.goto("/account");
    // Rendered by the client after it reads the session cookies, so seeing it
    // at all proves hydration ran under the policy.
    await expect(page.getByText("Your profile lives with your account")).toBeVisible();
    // And the world behind it: this route mounts a scene renderer of its own
    // now, which is a second thing the policy could refuse and a slower one to
    // notice, since a missing backdrop breaks nothing visible on the panel.
    await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(SCENE_SETTLE_MILLISECONDS);

    expect(await readDocumentPolicyViolations(page)).toEqual([]);
    expect(observations.policyViolations).toEqual([]);
    expect(observations.pageErrors).toEqual([]);
  });

  for (const familyName of FAMILY_PICKER_LABELS) {
    test(`does not block the ${familyName.toLowerCase()} renderer`, async ({ page }) => {
      await listenForPolicyViolations(page);
      const observations = observe(page);

      await page.goto("/");
      await page.getByRole("button", { name: familyName, exact: false }).first().click();
      await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(SCENE_SETTLE_MILLISECONDS);

      const documentViolations = await readDocumentPolicyViolations(page);
      expect(documentViolations, `CSP violations while rendering ${familyName}`).toEqual([]);
      expect(observations.policyViolations, `CSP refusals logged while rendering ${familyName}`).toEqual([]);
      expect(observations.pageErrors, `page errors while rendering ${familyName}`).toEqual([]);
    });
  }

  /**
   * The specific third party the self-hosted decoder replaced.
   *
   * `@react-three/drei` points its DRACO decoder at
   * `https://www.gstatic.com/draco/...` by default, and most of this app's
   * `.glb` models are DRACO-compressed — so before S8-IDENTITY-004 the nature
   * family depended at runtime on a Google host, and a CSP that blocked
   * third-party script would have broken it silently.
   *
   * This asserts the outcome rather than the configuration: the decoder is
   * fetched, and it is fetched from this origin.
   */
  test("fetches the DRACO decoder from this origin and never from Google", async ({ page }) => {
    const observations = observe(page);

    await page.goto("/");
    await page.getByRole("button", { name: DRACO_FAMILY_PICKER_LABEL, exact: false }).first().click();
    await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(SCENE_SETTLE_MILLISECONDS);

    const gstaticRequests = observations.requestedUrls.filter((url) => url.includes("gstatic.com"));
    expect(gstaticRequests, "the DRACO decoder was still fetched from Google").toEqual([]);

    const localDecoderRequests = observations.requestedUrls.filter((url) => url.includes("/vendor/draco/"));
    expect(
      localDecoderRequests.length,
      "the self-hosted DRACO decoder was never requested - either no DRACO model loaded on this page, or the decoder path is wrong"
    ).toBeGreaterThan(0);
  });
});
