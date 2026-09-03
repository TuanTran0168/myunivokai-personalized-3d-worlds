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

- `S3-CSP-001` **(Not started — needs a decision, not a patch)**: **nothing
  hydrates on a production build.** Every route except the three share pages is
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

  Verify first whether the deployed app is affected. The personalization app is
  on Vercel (see the note in `render.yaml`), and whether Vercel's runtime serves
  the prerender with this header decides whether this is a live outage or a
  latent one.
