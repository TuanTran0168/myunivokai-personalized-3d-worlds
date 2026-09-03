# FE Source Overview — apps/myunivokai-personalization

> **Document status:** Active
> **Last source review:** 2026-09-02

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
| `/gallery` | `src/app/gallery/page.tsx` | Worlds saved on this device, **scoped to whoever is signed in** — see `lib/savedWorlds.ts`. Family-aware, loaded in parallel |
| `/sign-in`, `/sign-up` | `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx` | Both render `features/identity/AuthCredentialsForm`. Sign-up also takes a display name |
| `/account` | `src/app/account/page.tsx` | The account's own page: name, full name, gender, and the defaults the create form is filled from. Renders `features/identity/AccountProfileForm` |
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
  (`API_BASE_URLS_BY_FAMILY`), and every method takes a family. The `normalize*`
  functions matter most: the BE returns `{ world, selectedVariant, variants }`
  (variant list at the response ROOT) and normalize maps everything onto the
  unified `World` / `WorldVariant` types. **The FE's worst historical bug lived
  here** (reading the wrong location sent the canvas into fallback mode). If a BE
  response shape changes, fix normalize first. Creation stores the pending job
  in session storage, polls `/api/jobs/{jobId}` with bounded backoff/deadline,
  supports `AbortSignal`, and loads the world only after completion.
- `lib/gateway.ts` — validates the one configured gateway origin and owns the
  family-to-public-prefix map. Browser requests and both server-rendered share
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
- `lib/productAuth.ts` — `signUp` / `signIn` / `signOut` /
  `refreshProductSession` / `authorizedGatewayRequest` / `fetchSignedInAccount`.
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
- `features/world-form/profileAutofill.ts` — the two pure functions that decide
  whether and how a saved profile fills the create form.
  `isCreateFormPristine` is the guard (the profile arrives from the network a
  moment after mount, and must never overwrite something already typed) and it
  deliberately IGNORES the nickname, because the display name is filled from
  storage before the profile answers. `createFormValuesFromProfile` overrides
  only where the profile has an answer — an empty saved field stops overriding
  rather than clearing the form's own default.
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
