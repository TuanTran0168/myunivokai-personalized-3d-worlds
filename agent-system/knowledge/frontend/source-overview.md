# FE Source Overview — apps/myunivokai-personalization

> **Document status:** Active
> **Last source review:** 2026-09-03

Next.js 15 App Router + React 19 + TypeScript + Tailwind + React Three Fiber v9.
Every page is a client component because of WebGL and localStorage.

Route params are Promises (Next 15): the two share pages await them, and
`worlds/[worldId]` — being `"use client"` — reads them with React's `use`.

## World families — one source, two scene worlds

The client renders two scene families from the **same source**:
`WorldFamily = "universe" | "nature"`. The create form (`/`) has a Universe /
Forest picker. The client receives one `NEXT_PUBLIC_GATEWAY_BASE_URL`; a shared
gateway helper appends `/api/universe` or `/api/nature` from the family. Peer
service hosts never enter the frontend. The family is plumbed through `api.ts`,
gallery localStorage ids, the `?family=` query param, and a twin nature share
route. See
[forest-render-mechanism.md](forest-render-mechanism.md) for the forest renderer
itself.

## Routes

| Route | File | Role |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Landing + family picker. Submit -> `202 + jobId` -> queued/processing polling -> completed world redirect; pending polling resumes after refresh |
| `/worlds/[worldId]` | `src/app/worlds/[worldId]/page.tsx` | Dashboard: 3D canvas, POI panel, variants, publish/share, PNG export. Reads `?family=` to pick the API + renderer |
| `/gallery` | `src/app/gallery/page.tsx` | Signed in: **every world the account owns**, from `GET /api/me/worlds` (`lib/galleryWorldSources.ts`). Signed out: worlds saved on this device (`lib/savedWorlds.ts`). Family-aware, loaded in parallel. Backdrop via `components/AmbientBackdrop` |
| `/sign-in`, `/sign-up` | `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx` | Both render `features/identity/AuthCredentialsForm`. Sign-up also takes a display name |
| `/account` | `src/app/account/page.tsx` | The account's own page: name, full name, gender, and the defaults the create form is filled from. `AccountProfileForm` owns the whole layout, heading included, because it also renders the world behind it — the scene the create form would open with, rebuilt as the fields change |
| `/share/worlds/[shareSlug]` | `src/app/share/worlds/[shareSlug]/page.tsx` | Public **universe** share page |
| `/nature/share/worlds/[shareSlug]` | `src/app/nature/share/worlds/[shareSlug]/page.tsx` | Public **nature** share page (twin route; nature-service prints share URLs with the `/nature` prefix) |
| `/ocean/share/worlds/[shareSlug]` | `src/app/ocean/share/worlds/[shareSlug]/page.tsx` | Public **ocean** share page, same twin-route reason |

`src/middleware.ts` sits in front of all of them and sets the
Content-Security-Policy with a per-request nonce (`lib/contentSecurityPolicy.ts`).
`npm run check:csp` is the only thing that can catch a hole in it — `tsc`, lint,
build and the unit tests all passed against a policy that produced fourteen
`connect-src blocked blob` violations per scene.

## The lib layer — every piece of data passes through here

- `lib/api.ts` — the single API client, now **family-aware and asynchronous**:
  `request(family, path, init)` picks the gateway route by `WorldFamily`
  (`API_PATH_PREFIXES_BY_FAMILY`) and sends it through
  `authorizedGatewayRequest`, so a world call carries the session and refreshes
  once on expiry. It carried none until 2026-09-03, which meant a signed-in
  visitor's world reached the gateway anonymous and was stamped with no owner.
  The generation poll is the deliberate exception and stays unauthenticated: a
  job belongs to whoever holds its id, and an expired token there would fail a
  poll on a world being generated at that moment.

  `createWorld` also sends `X-Anonymous-Id`, and only when signed OUT
  (`anonymousCreateHeaders`) — the gateway drops it whenever it has a verified
  account instead, so sending it while signed in would be a value nothing
  reads. That call is where the id is first minted, rather than on page load,
  so a visitor who only ever looked is never given an identifier. Every method takes a family. The `normalize*`
  functions matter most: the BE returns `{ world, selectedVariant, variants }`
  (variant list at the response ROOT) and normalize maps everything onto the
  unified `World` / `WorldVariant` types. **The FE's worst historical bug lived
  here** (reading the wrong location sent the canvas into fallback mode). If a BE
  response shape changes, fix normalize first. Creation stores the pending job
  in session storage, polls `/api/jobs/{jobId}` with bounded backoff/deadline,
  supports `AbortSignal`, and loads the world only after completion.
- `lib/gatewayRequest.ts` — the transport, with nothing about worlds or
  identity in it: `ApiError`, the 429 and `SERVICE_WAKING` retry loops,
  `requestGatewayJson`, `waitForDelay`. It is a separate module for a
  structural reason rather than a tidy one — `api.ts` needs the session and
  `productAuth.ts` needs the transport, so leaving it inside `api.ts` made the
  two import each other. `api.ts` re-exports `ApiError`, `requestGatewayJson`
  and `GatewayRequestHooks`, so the rest of the app has one import path.
- `lib/gateway.ts` — validates the one configured gateway origin and owns the
  family-to-public-prefix map (`apiPathPrefixForFamily` for browser calls,
  `apiBaseUrlForFamily` where a full base URL is still wanted). Browser requests and both server-rendered share
  metadata routes use this same helper. It deliberately has no direct-service
  fallback.
- `lib/types.ts` — mirrors the BE JSON contract. `WorldSceneConfig` (universe,
  `services/universe-service/internal/models/scene.go`) **and** the forest scene
  sections + `sceneType`. Change them together with the matching BE model.
- `lib/scene.ts` — safe scene-config readers (`planetsFromScene`,
  `paletteFromScene`, `backgroundColorFromScene`) + `randomFromSeed`
  (deterministic PRNG; `Math.random()` is forbidden in scene code). Also
  `FOREST_SCENE_TYPE` / `isForestScene` and `pointsOfInterestFromScene` (adapts
  forest landmarks into the shared POI/`PlanetSceneConfig` shape so HUD, hover
  and CameraRig stay family-agnostic).
- `lib/forestScene.ts` — **deterministic preview mirror** of the Go forest
  builder (`forest_scene_profile.go` + `forest_config_builder.go`): same tables,
  same per-section PRNG streams, same draw order (xorshift mirror → plausible,
  not byte-equal). Keep it in sync on every tuning change. Covered by
  `forestScene.test.ts` (determinism + contract-bounds).
- `lib/worldRoutes.ts` — family-aware path/query helpers (`worldPagePath`,
  `sharePagePath`, `worldFamilyFromQueryValue`, `WORLD_FAMILY_QUERY_PARAMETER`).
- `lib/savedWorlds.ts` — localStorage key `myunivokai.savedWorldIds`, now
  `SavedWorldReference { worldIdentifier, family, ownerKey }`. IDs saved
  automatically on create and when opening a world.

  **`ownerKey` is the whole of "whose worlds are these".** It is
  `account:<accountId>` for a world made while signed in and the constant
  `anonymous` for one made without an account; an entry with no `ownerKey`
  (saved before accounts existed) reads as anonymous, and a legacy plain-string
  entry as an anonymous universe world. The anonymous key is a CONSTANT and not
  the anonymous-id cookie on purpose: `localStorage` is already per-browser, so
  an id distinguishes nothing and can be lost when the cookie expires.

  Every read is filtered to one owner, which is why a brand-new account no
  longer opens onto a gallery full of the worlds the browser made before it
  existed. The duplicate check on write spans EVERY shelf, so opening an
  anonymous world while signed in does not quietly claim it — claiming is
  `S8-IDENTITY-011`, by anonymous id, deliberately not by world id.
  `moveAnonymousWorldsToOwner(ownerKey)` is the local half of the claim, and
  the reason the claim is visible at all: this gallery renders from
  `localStorage` filtered by owner, so a claim that moved five worlds in four
  databases would otherwise still show an empty grid. It runs only after the
  server accepted.

  **Since `S8-IDENTITY-016` this is a CACHE for a signed-in visitor**, not the
  list. `replaceCachedWorldReferences(ownerKey, serverReferences)` is the only
  thing that ever writes it from a server answer, and it REPLACES that owner's
  entries rather than merging with them — §8 asks for a merge and a merge
  brings deleted worlds back for ever, because winning a conflict only decides
  ids present in both lists and an id only the cache holds is exactly a
  deleted world. The anonymous shelf is never touched by it: no server answer
  can speak about worlds the server does not know the owner of.
- `lib/galleryWorldSources.ts` — where the gallery's list comes from, as pure
  functions with their IO passed in. `resolveGalleryWorldList` is the three-way
  decision (server, cache, browser), and it is pure precisely so that the case
  `S8-IDENTITY-016` calls its whole point — a signed-in visitor on a browser
  whose storage was just cleared — is a unit test: this app's vitest runs
  `environment: "node"` with no React testing library, so a decision left
  inside the hook would have been untestable in practice.

  `splitIntoHydrationBatches` keeps `?ids=` requests under the gateway's
  fifty-identifier cap. That cap was unreachable while the list was whatever
  one browser held; a server list has no such accidental ceiling, so a visitor
  with sixty worlds of one family would have got a 400 and fallen into the
  per-id fallback path. `MAXIMUM_GALLERY_SERVER_PAGES` is four, so the gallery
  shows the newest two hundred worlds — a stated ceiling rather than a silently
  truncated first page, since there is no paging control.
- `lib/generationNotice.ts` — the one thing this app says about how a world
  was built, and the three things it deliberately does not.
  `generationNoticeFor(job)` returns a sentence for `quota_exhausted` and
  `null` for the other three reasons: `ai_generated` (nothing happened),
  `mock_configured` (there was no AI tier to lose — **what production returns
  today**), and `ai_failed_fallback` (an incident, and staff's). It reads the
  REASON CODE and never a provider name, which would arrive as `mock` in three
  unrelated situations and force this module to guess which. Only a COMPLETED
  job speaks: the reason is written when the DNA is stored, before composition,
  so a `processing` job already carries it. The limit in the sentence comes off
  the job — a `5` in TypeScript would be a second declaration of a settings
  value. Fired from `src/app/page.tsx` on both generation paths, keyed on the
  job id so "a single toast" is structural.
- `lib/anonymousWorldClaim.ts` — `claimAnonymousWorldsForAccount()`, both
  halves of the claim in the one order they are safe in: ask the server, clear
  the anonymous cookie, then move the shelf. Its own module for the reason
  `galleryOwner.ts` is one — `savedWorlds.ts` is pure storage with no network
  in it. A failure leaves BOTH halves untouched, which makes the next sign-in
  the retry; the server's own `owner_account_id IS NULL` guard makes that retry
  a no-op if the first attempt actually worked.
- `lib/galleryOwner.ts` — `resolveGalleryOwnerKey()`, the async form of the
  above. `currentOwnerKey()` answers synchronously except in one case, a live
  session whose account copy was evicted from `localStorage`; this asks
  `GET /api/me` to recover it. Both answer `null` rather than guessing, and
  every caller shows and saves nothing on `null` — showing a signed-in person
  somebody else's worlds is worse than showing them none.
- `lib/productSession.ts` — the three client-written cookies
  (`myunivokai_access`, `myunivokai_refresh`, `myunivokai_anonymous`) plus the
  account copy in `localStorage`. **None is `httpOnly` and none can be**, so
  the CSP is the control, not the cookie flags.

  The anonymous id is minted HERE, by `crypto.randomUUID`, not by the gateway —
  the plan's §7 says the gateway mints it and is corrected: two tabs creating
  at once would each be handed a different id and one world would be orphaned.
  It is cleared in exactly one place, `clearAnonymousIdentifier`, after a claim
  succeeds; `clearProductSession` deliberately leaves it alone, because signing
  out is not becoming a different visitor. `ANONYMOUS_IDENTIFIER_HEADER_NAME`
  lives here too, and must stay in the gateway's product CORS `AllowedHeaders`
  or every request carrying it fails in a browser and passes in every test.
- `lib/productAuth.ts` — `signUp` / `signIn` / `signOut` /
  `refreshProductSession` / `authorizedGatewayRequest` / `fetchSignedInAccount`
  / `claimAnonymousWorlds`. The claim reads the anonymous id rather than
  read-or-creating it — minting one in order to claim with it would name worlds
  that cannot exist — and clears the cookie only after the server answered.
  Refresh is single-flight at module scope because the refresh token is
  single-use with family-wide reuse detection: two parallel refreshes would
  present the same token twice and revoke the whole family.
- `lib/accountProfile.ts` — `GET`/`PATCH /api/me/profile`. `creationDefaults`
  is `CreateWorldInput`, the same type the generate call takes, so the profile
  cannot express something the create form could not hold.
- `features/world-form/worldFormOptions.ts` — every vocabulary the create
  form offers (families, interests, traits, per-family moods and styles,
  palette), plus `FAMILY_COPY`, `defaultStyleForFamily` and
  `CREATE_FORM_INITIAL_VALUES`. Moved out of `app/page.tsx` when the account
  page started offering the same fields; each list mirrors a backend vocabulary
  (`allowedMoods`, `allowedWorldStylesByFamily`), so a second copy is how the
  two screens come to offer a value the other cannot render.
- `features/world-form/profileAutofill.ts` — the pure functions that decide
  whether and how a saved profile fills the create form, plus
  `profileWithCreateFormDefaults`, which is how the account page can mirror the
  create form's MINIMUMS (3 interests, 3 traits, 1 colour) without being
  unusable on a first visit: an unanswered list is shown holding what the
  create form itself opens with. The server stays permissive — it bounds what
  may be stored, and a row written before the rule still has to load.
  `isCreateFormPristine` is the guard (the profile arrives from the network a
  moment after mount, and must never overwrite something already typed) and it
  deliberately IGNORES the nickname, because the display name is filled from
  storage before the profile answers. `createFormValuesFromProfile` overrides
  only where the profile has an answer — an empty saved field stops overriding
  rather than clearing the form's own default.
- `features/world-form/createWorldPayload.ts` — `buildCreateWorldPayload`, the
  form's ten values as the request the backend receives, fallbacks and all. The
  live preview is built from THIS rather than from the raw fields, so the scene
  on screen has the planet count and names the generated world will have; that
  coupling is why the sanitising is one function and not two.
- `features/world-form/previewScene.ts` — which family's scene builder runs.
  `buildPreviewSceneForFamily` is the create page's live preview (keyed on the
  canvas's lagging family, not the form's), and `buildCreateFormPreviewScene`
  is the whole account-page backdrop: the world the create form would open with,
  from the profile on screen.
- `components/AmbientBackdrop.tsx` — the fixed z-0 world behind a page, with the
  dpr cap, parked entry, dim and vignette. Shared by `/gallery` and `/account`;
  its content column carries `relative z-10` and the backdrop is its SIBLING,
  never its child, or the fixed layer paints over the heading. Ambient sound is
  opt-in and off by default, because a backdrop rebuilt as somebody types would
  restart its soundscape on every rebuild.
- `lib/useDebouncedValue.ts` — the hook and
  `PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS`, shared by both previews so they
  cannot drift apart.
- `components/Toast.tsx` — one message about something that has already
  finished, over the page rather than beside a control. `StatusMessage` still
  reports on the control it sits next to (a save in progress, a field that will
  not do); this reports on an action that is over, which is why it is not
  anchored. `toastLifetimeMilliseconds` is the tested part: a success leaves on
  its own, a failure waits to be dismissed.
- `lib/exportImage.ts` — downloads the WebGL canvas as PNG
  (requires `preserveDrawingBuffer`, already set on the Canvas).
- `lib/formRailCollapse.ts` + `components/WorldChromeToggle.tsx` — the one-button
  "clear the interface off the world" control, shared by the create, world and
  share pages. The collapsing region is never unmounted (on the create page the
  submit button sits outside the `<form>` and would lose its owner); it slides or
  fades and flips `visibility`, so fields keep their values and the GL context
  survives. Two `<body>` markers carry state the pages cannot reach with a
  selector — `data-world-immersive` hides the shared header/footer,
  `data-world-family` swaps the accent metal (brass → copper for forest). Those
  attribute names and the collapse duration are contracts between TypeScript and
  CSS with no compiler between them, so `formRailCollapse.test.ts` parses
  `globals.css` and fails if either drifts. See
  [../user-stories/world-chrome.md](../../plans/backlog/world-chrome.md).

## The 3D part

- [threejs-scene-architecture.md](threejs-scene-architecture.md) — three.js
  principles, the **sceneType-first** renderer registry, and how to add a scene
  type.
- [universe-render-mechanism.md](universe-render-mechanism.md) — how the universe
  is drawn (4 model layers, texture/GLB pipelines, determinism).
- [forest-render-mechanism.md](forest-render-mechanism.md) — the forest/nature
  renderer: instanced + animated GLBs, seasonal foliage recolor, bird animation
  gotchas, the horizon technique, and the **Sketchfab asset constraint**.

## State

No Redux/Zustand. Each page owns its state with `useState`/`useMemo`; planet
selection syncs between canvas and panel via props (`selectedPlanetKey` +
`onSelectPlanet`). Reach for a store only if state starts spanning pages.

The create page has the one piece of state worth knowing before editing it:
`worldFamily` is what the form says and `renderedWorldFamily` is what the
canvas shows, and the second lags the first by the length of the departure
animation on purpose (`features/transitions/worldChangeStages.ts`). They are
two halves of one invariant, so **`showWorldFamilyOnCanvas` is the only place
`setWorldFamily` is called** — a second writer is exactly how a profile's
preferred family came to fill the picker while the canvas stayed a universe.

## Known upgrade boundaries

- `SceneConfig` is a broad optional interface and API normalization still uses
  `any`; it is not yet a schema-derived discriminated union with runtime
  validation.
- Both family renderers are statically imported by `registry.ts`; lazy family
  chunks remain pending.
- The main canvas allows DPR up to 3 and has no adaptive quality profile or
  recoverable WebGL error boundary.
- Nature GLBs are self-hosted, but Drei still uses its default external Draco
  decoder because no local decoder path is configured.
- Catalog tests do not yet validate every asset path, attribution entry, and
  byte budget.
- `npm audit` still reports three high advisories, and none is against `next`
  itself any more. They are `postcss@8.4.31` and `sharp@0.34.5`, both pinned
  inside next's own dependency tree and unreachable from this app: postcss runs
  at build time, and `next/image` is used exactly once, with `unoptimized`, so
  the Image Optimizer that would load sharp never runs. Replacing next's pinned
  postcss needs Next 16.

See `agent-system/plans/backlog/engineering-backlog.md` for Given/When/Then acceptance.

## Required checks before committing

```bash
cd apps/myunivokai-personalization
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run test` is a hard CI step between lint and build; this list omitted it
until 2026-08-01, so a contributor following the old block could push a red
build.

`npm run shoot` is **not** in that list and must not be added to it. It
photographs both scene families and writes to `e2e/shots/`, to be compared by
eye against `e2e/reference/<stack>/` — the only instrument in this repo that
can see the canvas. Run it either side of a dependency change, never as a gate:
WebGL output moves with GPU and driver, so a pixel assertion in CI would report
"different machine" far more often than "broken scene". See
`apps/myunivokai-personalization/e2e/reference/README.md`.

For integrated local development, root `docker-compose-local.yaml` builds this
client with `NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:41800`. The production
Docker image uses exactly two stages, Next.js standalone output, and a non-root
runtime user; the same image is declared in the Render Blueprint.
