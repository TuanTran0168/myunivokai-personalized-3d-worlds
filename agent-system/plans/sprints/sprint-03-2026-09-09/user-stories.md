# Sprint 03 user stories — City vertical slice

> **Document status:** Planned, except the chrome section below, which is Implemented
> **Sprint starts:** 2026-09-09 (moved from 2026-08-19; see the sprint README)
> **Last source review:** 2026-09-03

- `S3-CITY-CONTRACT-001`: map canonical ProfileDNA to versioned deterministic
  CitySceneConfig without changing Universe/Nature contracts.
- `S3-CITY-SERVICE-001`: add isolated `city-service`, NATS ACLs, inbox/outbox,
  `myunivokai_city`, lifecycle queries, and deployment `myunivokai-city`.
- `S3-CITY-FE-001`: ship the high-fidelity desktop City renderer and full
  create/get/variant/publish/share flow through the existing Gateway.
- `S3-CITY-ASSET-001`: self-host and license every City asset with visual and
  byte-budget baselines.

City remains blocked until Sprint 1 live verification and Sprint 2 resilience
gates pass.

## Chrome and identity surfaces

Folded into this sprint on the owner's instruction rather than given a sprint of
its own — it is frontend-only, touches none of City's services, contracts or
databases, and City's own renderer will inherit the material rule below.

The work came from four screenshots and five sentences of feedback: the
credential screens looked dead, panels read through each other, a save
confirmation landed on the button that produced it, the profile menu was a
column of bare sentences, and one line of copy used a semicolon.

- `S3-CHROME-001` **(Implemented)**: give the interface a SECOND glass material
  and a rule for which surface gets which. `--glass-overlay-*` is iOS 26's
  `regular` glass — real tint, real blur — and the existing near-invisible one
  is its `clear`. The rule: **clear where the world is the subject, regular
  where the panel is the subject.** The create form's rail stays clear, because
  the world behind it is the thing being configured. A menu, a toast and the
  sign-in card become regular, because the world behind those is scenery.
- `S3-CHROME-002` **(Implemented)**: put a world behind `/sign-in` and
  `/sign-up`, one per screen and different on purpose, and rebuild both as an
  editorial two-column screen rather than a card on a black page.
- `S3-CHROME-003` **(Implemented)**: one place a message about a finished action
  appears (`--toast-inset-top`), shared by the two toast surfaces this app has,
  and both ways out offered inside it — the create form and the gallery, never
  the page being looked at.
- `S3-CHROME-004` **(Implemented)**: an account menu with an identity, an icon
  on every row, and a width that fits a 375px bar.

### Corrections — written after the work, and they contradict the brief

1. **"Add a Delete beside it" was the wrong shape of instruction twice, and this
   is the second time.** Sprint 8's Phase C found it for the gallery's remove
   button. Here it was the account menu's transparency: making the menu opaque
   is not a change to the menu, it is a change to the SYSTEM — there was one
   material where there had to be two, and a fix confined to the menu would have
   left the same collision waiting in every dropdown, dialog and toast added
   later. The owner's word for the earlier material was "trong suốt"
   (see-through) and that instruction is still honoured; what changed is that it
   now applies to a defined half of the interface instead of all of it.
2. **A material must not declare `position`.** `.glass-overlay` began with
   `position: relative`, which reads as harmless. globals.css loads after
   `@tailwind utilities`, so it out-ranked the `absolute` on the account menu's
   own panel: the dropdown laid itself out inside the 57px header bar and hung
   off the top of the viewport. Every call site now says where it is, and the
   material says only how it looks.
3. **`backdrop-filter` is the first thing a compositor drops, so the tint has to
   work without it.** At the 0.72 alpha that looks right on a GPU, the create
   form's live-preview text was still readable through the open menu under
   software rendering — the exact defect the material exists to fix, back again
   on the machines least able to spare a second render. 0.84 with the blur is
   the shipped value: the blur makes it beautiful, the tint makes it correct.
4. **The header was already overlapping itself at 375px, and nobody had said
   so.** The wordmark, Gallery, the identity control and Create World wanted
   about 440px of a 375px bar, worst when signed in, because the identity
   control then carries a name. Two labels became `sr-only` below `sm` — the
   accessible names survive, the collision does not. It was found by taking the
   mobile shots this work added, not by looking for it.
5. **The toast moved to the top rather than being nudged.** `bottom-20` was over
   the footer and, on the one page that used it, over the Save button and the
   way out beside it. It could have been raised; instead the position became the
   `--toast-inset-top` the sonner stack already had in a prop, because two
   surfaces that report the same kind of event must not appear in two places.

### The defect this work uncovered and did NOT fix

- `S3-CSP-001` **(Implemented 2026-09-04 on
  `fix/fe/content-security-policy-hydration`. The heading above stays as
  written: the chrome work did uncover this and did not fix it — the fix came
  later, on its own branch)**: **nothing hydrated on a production build.** Every route except the three share pages is
  prerendered (`○` in `next build`), so its HTML is written at build time with no
  nonce, while `src/middleware.ts` sends a per-request
  `script-src 'self' 'nonce-…' 'strict-dynamic'`. `'strict-dynamic'` disables
  the `'self'` allowance, so the browser refuses every app chunk and the page
  never becomes interactive: no account menu, no 3D world, no form validation.

  Reproduce, from `apps/myunivokai-personalization`:

  ```bash
  SHOOT_PORT=41399 npm run shoot -- e2e/content-security-policy.spec.ts --project=desktop
  # 7 of 8 fail: everything that needs hydration
  ```

  **It is pre-existing and it is on `staging`** — the same command on `staging`
  fails the same way. `npm run check:csp` has been green because it defaults to
  port 41300 with `reuseExistingServer`, so it silently attached to whichever
  development server was already running, and `next dev` injects the nonce
  correctly. The `SHOOT_PORT` override added by `S3-CHROME-002` is what made the
  production build reachable at all, and it is the reason this was found.

  Next's nonce mechanism requires DYNAMIC rendering, so the fix is a choice with
  a cost, which is why it is a story and not a commit: opt the app out of static
  prerendering, or replace the script nonce with something a prerender can
  carry. `'unsafe-inline'` is not on the list — `lib/contentSecurityPolicy.ts`
  already explains why it would be a policy that permits the attack it exists to
  stop.

#### What the deployment turned out to be doing — the story's own first step

Measured 2026-09-04 against `https://myunivokai.vercel.app`, confirmed by the
owner as the personalization app's production domain:

| Probe | Answer |
| --- | --- |
| `content-security-policy` header | **absent** |
| `nonce=` in the returned HTML | **0** |
| `/sign-in`, `/sign-up`, `/account`, `/worlds` | **404** |
| `main-app` chunk hash | `be5280ba…`, against `fe39c272…` built from `staging` |
| `src/middleware.ts` on `origin/main` | **does not exist** (only the admin app's) |

So: **latent, not a live outage** — but latent only because production predated
the middleware that causes it. `origin/main` was **46 commits** behind `staging`,
and the whole of Sprint 08's frontend, the CSP included, had never been
deployed. **The first merge of `staging` into `main` would have made it a total
outage**, which is why this was fixed ahead of the City slice and recorded as a
Sprint 08 release blocker in that sprint's README.

#### The decision: every route segment renders per request

`export const dynamic = "force-dynamic"` in `src/app/layout.tsx`, inherited by
every segment below it — verified by `next build`, which now marks all ten page
routes `ƒ`. Only `/icon.svg` and `/icon1.png` stay `○`; the middleware matcher
excludes both by extension, so neither is served a policy or needs a nonce.

Declared explicitly rather than by calling `headers()` somewhere in the tree to
force dynamic rendering as a side effect. That is how Next's own nonce examples
read, and it makes an unused-looking call load-bearing — the next reader to tidy
it away would restore a silent total outage.

The two alternatives named in the original write-up were both rejected on
evidence rather than on taste:

- **Hash the inline scripts.** The page carries 7 inline `<script>` tags,
  including the `self.__next_f` flight payload, whose contents change with the
  route and the build. A hash list would need regenerating by the build that
  invalidates it.
- **Add `'unsafe-inline'` as a fallback.** It is not a fallback. A browser that
  understands nonces ignores `'unsafe-inline'` entirely, so it would apply on
  exactly the prerendered pages that lack a nonce — granting inline script
  precisely where the policy is the session's only defence.

#### What the browser was actually refusing, before and after

The original write-up reasoned from the header to the outcome. It was measured
directly instead, because `output: standalone` prints a `next start` warning
that stood next to the failure and had to be ruled out as the cause:

| On `/sign-in` | Before | After |
| --- | --- | --- |
| script tags | 20 | 15 |
| refused requests | **12, every one `errorText: csp`** | 0 |
| React root children | 0 | hydrated |
| `self.__next_f` present | `false` | `true` |
| page errors thrown | **none** | none |

Chrome named the mechanism itself: *"'strict-dynamic' is present, so host-based
allowlisting is disabled"*. The last row is why nothing in the repository could
see this — no exception is thrown anywhere, so `tsc`, `next lint`, `next build`
and 801 unit tests were all green over an app that never became interactive.

#### Measured cost, because this line looks like a regression

Median time-to-first-byte on a local production server, 25 samples per route:

| Route | Prerendered | Per-request | Delta |
| --- | --- | --- | --- |
| `/` | 3.1 ms | 7.7 ms | +4.6 ms |
| `/sign-in` | 2.8 ms | 6.0 ms | +3.2 ms |
| `/gallery` | 2.9 ms | 5.6 ms | +2.7 ms |

These pages fetch nothing server-side, so per-request rendering only rebuilds
the shell. **What this does not measure** is the platform effect: on Vercel the
documents become function invocations instead of CDN static hits, and localhost
cannot show that. Stated rather than estimated.

#### The regression guard, and why it is not the e2e suite

**CI runs no Playwright at all** — `.github/workflows/ci.yml`'s frontend job is
typecheck, lint, test and build, with no browser step. So the suite that proves
this is a local verdict, not a gate, and the guard had to be a unit test.

`src/lib/contentSecurityPolicy.test.ts` gains three assertions, next to the
policy they protect: that the policy does ask for a nonce and `'strict-dynamic'`
(so the premise is stated rather than assumed), that the root layout declares
`force-dynamic`, and that **no route segment takes it back** — `force-static`,
`dynamic = "error"` or any `revalidate`, in any `page`/`layout`/`template`
under `src/app`. Same shape as `oceanShaderSource.test.ts`: a lint over source
text, because the real verdict only exists in a browser.

Both halves were verified RED by mutation, not merely green: removing the export
fails the second, and adding `revalidate = 60` to `gallery/page.tsx` fails the
third **and names the file**.

#### Done means

- [x] `SHOOT_PORT=41399 npm run shoot -- e2e/content-security-policy.spec.ts
      --project=desktop` passes **8 of 8**, from 1 of 8.
- [x] `next build` marks every page route `ƒ`.
- [x] The policy is unchanged — no directive was weakened to make this pass.
      `'strict-dynamic'` stays, `'unsafe-inline'` is still absent from
      `script-src`, and the header is present on `/`, `/sign-in`, `/gallery`
      and `/account`.
- [x] typecheck, lint, 804 unit tests (801 + 3) and build all clean.
- [x] The cost is measured and written down rather than assumed.

#### One thing this branch found and deliberately did not fix

`next.config.mjs` sets `output: "standalone"`, and `next start` responds
*"'next start' does not work with 'output: standalone' configuration"* — which
`playwright.config.ts` uses as its web server, so every spec in `e2e/` runs
against a server Next itself calls misconfigured. It serves correctly enough
that all 8 CSP assertions pass, and it was ruled out as the cause of this defect
by direct measurement. But `standalone` is a self-hosting output and this app is
on Vercel, so the setting appears to buy nothing and cost a warning. Changing
`output` touches how the app is built for deployment, which is not this
branch's concern and needs its own decision.
