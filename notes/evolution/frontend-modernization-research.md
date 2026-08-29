# Frontend modernization research — Next.js 16, React 19, R3F v9, WebGPU

> **Document status:** Research, and **Route A is now built** —
> `feat/fe/next-15-react-19`, 2026-08-14. Five of this document's claims did not
> survive execution and are corrected in
> §What executing it actually found, which is the section to read before acting
> on anything below. Route B (Next 16), three.js 0.185 and WebGPU remain
> research only.
> **Raised:** 2026-08-12 by the owner — *"cái này khá nguy hiểm vì các function
> có thể outdate hoặc lỗi diện rộng toàn FE… nó có thể phá sập hệ thống nếu hời
> hợt"*.
> **Last source review:** 2026-08-12
> **Method:** every version number and peer-dependency range below was read from
> the **npm registry** on 2026-08-12, and every framework claim from the
> **official upgrade guide**, not from memory. Where a thing could not be
> verified this session it is listed under §What is still unverified rather than
> asserted. That section is not an apology; it is the part to read first if
> someone is about to start.
> **Supersedes:** [platform-evolution-research.md](platform-evolution-research.md)
> §Track D, which contains three errors of fact corrected in §Corrections below.

---

## The headline: the premise of this migration is wrong

Every prior note in this repo, including Track D, assumed the chain
*security advisories → Next 16 → React 19 → R3F v9 → WebGPU*, with Next **16**
as the entry point because that is what `npm audit fix --force` prints.

That is not what the advisory data says.

`npm audit` reports **21 separate advisories against `next`** in
`apps/myunivokai-web`. Their fixed-version boundaries are:

```
<15.0.8   <15.5.10   <15.5.13   <15.5.14   <15.5.15   <15.5.16   <15.5.21
```

**The highest boundary is `15.5.21`.** The published `next` `backport` dist-tag
is **15.5.23**. So:

> **`next@15.5.23` clears all 21 of them. Next.js 16 is not required to close
> the framework's own security hole.**

npm prints `16.3.0` because `fixAvailable` reports the `latest` tag, not the
minimum sufficient version. Acting on that print is how a security patch turns
into a two-major-version rewrite of the only public-facing app.

(One nested advisory does survive Route A, and it is examined honestly in
§The catch below — it does not change this conclusion, but nobody should meet
it by surprise.)

This changes the shape of the decision from *"when do we dare do the big
upgrade"* to *"do we take the small one now and the big one on its own
schedule"* — and those have very different risk profiles.

One caveat, stated up front because it is the counter-argument: **Next 14 has
no patched release.** The advisory ranges start at `>=13.0.0` / `>=10.0.0` and
end in the 15.5.x line with no 14.x carve-out, so `next@14.2.35` — the newest
14 — is still inside every one of them. Staying on 14 is not an option that
survives contact with the data. The choice is 15 or 16, not 14 or 16.

### And the exposed surface is smaller than "8 high" suggests

`npm audit` reports **8 high** for `myunivokai-web`. `npm audit --omit=dev`
reports **3**:

| Advisory | Ships to users? | Source |
| --- | --- | --- |
| `next` | **yes** | direct dependency |
| `postcss` | **yes** | transitive, via `next` |
| `nanoid` | **yes** | transitive, via `postcss` |
| `eslint-config-next`, `@next/eslint-plugin-next`, `glob`, `brace-expansion`, `js-yaml` | **no — devDependencies** | the ESLint 8 toolchain |

All three production advisories trace to one root: `next`. And the acceptance
criterion written into
[`S1-SECURITY-001`](../plans/sprints/sprint-01-2026-07-22/user-stories.md) is
literally *"`npm audit --omit=dev --audit-level=high` exits 0"* — so **only
those three count against the story**.

Which means the ESLint 8 → 9 / flat-config work, which the story lists as part
of the upgrade and which Next 16 forces, **carries no security urgency at all**.
It is a devDependency cleanup that can be scheduled on its own merits, on its
own day.

### The catch, and it is a real one

`next` pins `postcss` **exactly**, and it does not move it until 16:

| `next` | pinned `postcss` | vs advisory (`<=8.5.22`) |
| --- | --- | --- |
| 14.2.23 (installed) | `8.4.31` | vulnerable |
| **15.5.23** | **`8.4.31`** | **still vulnerable** |
| 16.3.0 | `8.5.23` | clear |

So the accurate statement is narrower than the headline:

> **`next@15.5.23` clears all 21 `next` advisories, but not the `postcss` and
> `nanoid` ones nested underneath it. `npm audit --omit=dev --audit-level=high`
> would still exit non-zero on Route A.**

The repo's own top-level `postcss` devDependency can be bumped freely
(`8.5.26` is published), but that only fixes the hoisted copy — `next` keeps
its own at `node_modules/next/node_modules/postcss`, and only a move to 16
replaces it.

**How much this actually matters is a judgement, and it should be made
explicitly rather than by a red CI line.** The two `postcss` advisories are
*"XSS via unescaped `</style>` in CSS stringify output"* and *"arbitrary file
read"* — both require **attacker-controlled CSS reaching the parser**. PostCSS
here runs at build time, in CI, over this repository's own stylesheets. There
is no path by which a visitor supplies CSS. Compare that with the `next`
advisories being closed: SSRF in rewrites, cache poisoning of RSC responses,
XSS in App Router, DoS — all of them on the request path of a live public site.

Route A therefore closes **the entire class of risk that is real here** and
leaves a build-time parser advisory that the criterion counts but the threat
model does not. Two defensible responses:

- **Amend `S1-SECURITY-001`** to except build-time-only transitive advisories,
  with this paragraph as the reasoning, and take Route A.
- **Take Route B** and satisfy the criterion literally.

What should *not* happen is discovering this at the end of Route A and calling
the upgrade a failure because a number is not zero.

That story also predates the current data in two further ways worth correcting
when it is next touched: it records *"one high and one moderate"* from the
2026-07-23 audit (now three high in production), and it states *"its available
remediation is a Next.js 16 major upgrade"* — true for `postcss`, and not the
reason it says.

---

## Verified landscape, 2026-08-12

Installed versus published. Every "latest" read from the npm registry today.

| Package | `myunivokai-web` has | Latest published | Gap |
| --- | --- | --- | --- |
| `next` | `14.2.23` | `16.3.0` | 2 majors |
| `react` / `react-dom` | `18.3.1` | `19.2.8` | 1 major |
| `@react-three/fiber` | `8.18.0` | `9.7.0` | 1 major |
| `@react-three/drei` | `9.122.0` | `10.7.8` | 1 major |
| `@react-three/postprocessing` | `2.19.1` | `3.0.5` | 1 major |
| `three` | `0.171.0` (2024-11-29) | `0.185.1` (2026-07-01) | 14 minors, ~19 months |
| `tailwindcss` | `3.4.17` | 4.x | 1 major |
| `eslint` | `8.57.1` | 9.x | 1 major |

And the fact that reframes everything — **the other app is already there**:

| | `myunivokai-web` | `myunivokai-admin` |
| --- | --- | --- |
| `next` | 14.2.23 | **15.5.22** |
| `react` | 18.3.1 | **19.0.0** |
| `tailwindcss` | 3.4.17 | **4.x** |
| `eslint` | 8.57.1 | **9.x** |
| three.js | yes, heavily | **none** (a boundary script forbids it) |
| Deployed on | Vercel | Vercel |

`myunivokai-admin` has been running Next 15 + React 19 on Vercel in CI and in
production shape for the whole of this project. **The framework half of this
migration is already proven in this repo.** What is unproven is exclusively the
3D half — which is also the half no test covers (§The blind spot).

---

## The dependency knot

This is where a careless `npm install` does the damage. Peer ranges, read from
the registry today:

| Package | version | `react` | `three` | `@react-three/fiber` |
| --- | --- | --- | --- | --- |
| `@react-three/fiber` | 9.7.0 | `>=19 <19.3` | `>=0.156` | — |
| `@react-three/fiber` | 9.0.0 | `^19.0.0` | `>=0.156` | — |
| `@react-three/drei` | 10.7.8 | `^19` | `>=0.159` | `^9.0.0` |
| `@react-three/postprocessing` | **3.0.5** | `^19.2.0` | **`>= 0.182.0`** | `>=9.7.0` |
| `@react-three/postprocessing` | **3.0.4** | `^19.0` | **`>= 0.156.0`** | `^9.0.0` |
| `next` | 15.5.23 / 16.3.0 | `^18.2.0 \|\| ^19.0.0` | — | — |

Three things fall out of that table, and two of them are traps.

**Trap 1 — `@react-three/postprocessing@3.0.5` drags three.js with it.** Only
the newest patch raised its three.js floor to `>= 0.182.0`. Taking `latest`
therefore forces `three` from `0.171.0` to at least `0.182.0` — **11 minor
releases and 13 months of three.js drift**, in the same change as a React major
and an R3F major. three.js minors routinely retune colour management, tone
mapping and light units; those do not fail a build, they **change how the scene
looks**, silently, in a product whose entire value is how the scene looks.

The escape is one line: pin **`@react-three/postprocessing@3.0.4`**, whose floor
is `>= 0.156.0`. The repo's `three@0.171.0` satisfies it. **The three.js bump
becomes a separate, later, independently reversible change** instead of a
passenger on the React upgrade. This single pin is the highest-leverage
decision in the whole document.

**Trap 2 — the React version window is narrow and closing.** `fiber@9.7.0`
caps React at `<19.3` while `postprocessing@3.0.5` floors it at `^19.2.0`. The
legal window with `latest` everywhere is **React 19.2.x only**. Latest React is
`19.2.8`, so it works today, but a React 19.3 release makes `fiber@9.7.0`
illegal until pmndrs publishes. Pinning `postprocessing@3.0.4` widens the floor
back to `^19.0`, which is a second reason to prefer it.

**Not a trap — `next` does not force React 19 at the peer level.** Both 15.5.23
and 16.3.0 declare `^18.2.0 || ^19.0.0`. But the official Next 15 upgrade guide
is explicit and overrides the manifest: *"The minimum versions of `react` and
`react-dom` is now 19."* Treat React 19 as **mandatory from Next 15**, and read
the loose peer range as legacy Pages-Router tolerance, not permission.

**Maturity, since "is v9 too new" is the obvious worry.** `@react-three/fiber`
**9.0.0 shipped 2025-02-19** — eighteen months ago — and has had **19 stable
9.x releases** since, the newest (`9.7.0`) on 2026-07-31. `@react-three/drei`
**10.0.0 shipped the same day**, with **33 stable 10.x releases** since, the
newest on 2026-08-05. This is not a bleeding edge. It is a line that has been
stable longer than this project has existed.

---

## Next.js: what actually applies to this repo

The repo's Next surface is unusually small, and that is the good news that
makes the rest survivable. Imports, counted: `next/link` ×5, `next` (types) ×4,
`next/navigation` ×2, `next/image` ×1, `next/font/google` ×1. **No route
handlers. No middleware. No `next/server`. No server actions. No `next/cache`.**
49 of 52 `.tsx` files carry `"use client"`.

Almost the entire Next 15 and Next 16 breaking-change surface is server-side.
This app barely has a server side.

### The 14 → 15 hop

| Breaking change | Applies here? |
| --- | --- |
| **Async `params` / `searchParams`** | **YES — 3 files.** The only real hit |
| React 19 minimum | **YES** — the whole point |
| `fetch` no longer cached by default | No — no server-side `fetch` |
| `GET` Route Handlers no longer cached | No — no route handlers |
| Client Cache: page segments not reused on `<Link>` | **Behavioural, yes.** Data is fetched client-side in `useEffect`, so a back-navigation refetches. Not a break; a perceived-latency change worth watching |
| `next/font` ← `@next/font` | No — already `next/font/google` |
| `runtime: 'experimental-edge'` | No |
| `NextRequest.geo` / `.ip` removed | No |
| Speed Insights auto-instrumentation removed | No |
| `bundlePagesExternals` / `serverComponentsExternalPackages` renames | No |

### The 15 → 16 hop

Next 16 is where sync `params` stops being tolerated: *"Starting with Next.js
16, synchronous access is fully removed."* Next 15 keeps a deprecation window
with a dev warning; Next 16 does not.

| Breaking change | Applies here? |
| --- | --- |
| Sync request APIs **removed** (not just deprecated) | **YES — the same 3 files, now mandatory** |
| **Turbopack is the default for `next dev` AND `next build`** | **YES, by default.** Mitigated: the repo has **no custom webpack config**, which is the documented cause of hard build failures. Opt out with `next build --webpack` if needed |
| `next lint` **removed**; `next build` no longer lints | **YES.** `package.json` still has `"lint": "next lint"`. Codemod: `next-lint-to-eslint-cli` |
| `@next/eslint-plugin-next` defaults to **flat config** | **YES** — pairs with the ESLint 8 → 9 move |
| `next/image`: `qualities` default → `[75]`, `imageSizes` drops 16, `minimumCacheTTL` 60s → 4h, redirects capped at 3, local-IP blocked | **Marginal** — one `<Image>`, in `layout.tsx`. Worth an eyeball, not a project |
| `middleware` → `proxy` | No |
| Scroll-behaviour override removed unless `data-scroll-behavior="smooth"` | **No** — verified: no `scroll-behavior` rule anywhere in `src/` |
| Parallel-route `default.js` now required | No |
| AMP removed | No |
| `serverRuntimeConfig` / `publicRuntimeConfig` removed | No |
| `experimental.ppr` / `dynamicIO` / `useCache` removed | No |
| `revalidateTag` needs a second argument | No |
| Node ≥ 20.9, TypeScript ≥ 5.1 | **Satisfied** — CI runs Node 24, repo is TS 5.7 |
| Browser floor Chrome/Edge/Firefox 111+, Safari 16.4+ | Satisfied for a WebGL2 app |

Two Next 16 items deserve their own line because they are easy to miss:

**`next build` no longer prints `size` and `First Load JS`.** Vercel removed
them as inaccurate for RSC architectures. This repo's own performance notes are
denominated in that metric — *"436–450 kB First Load JS on the 3D routes"*. If
the fleet moves to 16, **the number the frontend has been optimised against
stops existing**, and bundle-size regressions become invisible unless something
replaces it. That is a measurement loss, not a code break, and it is the kind
that is noticed a year late.

**Both `next dev` and `next build` default to Turbopack.** The repo loads `.glb`
models and raw GLSL strings; those are plain static imports and template
literals, not loaders, so nothing obviously breaks — but this is a whole new
bundler for a heavy 3D dependency graph and it belongs in the "verify in a
browser, not in CI" bucket.

### The exact code change, all three files

Both patterns are in the official guide. **Server component** —
`app/universe/share/worlds/[shareSlug]/page.tsx` and its `nature` twin:

```tsx
type PageProps = { params: Promise<{ shareSlug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareSlug } = await params
  return buildShareWorldMetadata("universe", shareSlug)
}

export default async function UniverseShareWorldPage({ params }: PageProps) {
  const { shareSlug } = await params
  return <ShareWorldView shareSlug={shareSlug} family="universe" />
}
```

**Client component** — `app/worlds/[worldId]/page.tsx`, which is `"use client"`
and therefore cannot `await`:

```tsx
"use client"
import { use } from "react"

type PageProps = { params: Promise<{ worldId: string }> }

export default function WorldPage(props: PageProps) {
  const { worldId } = use(props.params)
  // ...unchanged
}
```

Codemod: `npx @next/codemod@canary next-async-request-api .` — and `npx next
typegen` generates `PageProps<'/worlds/[worldId]'>` helpers if preferred over
hand-written types.

**Three files. That is the entire Next-side code change.** The scale of this
migration is not in Next.js.

---

## React 19: what actually applies

Checked against the source, not assumed. Two of these were resolved by grep and
came back clean:

| React 19 change | Applies here? |
| --- | --- |
| `propTypes` / `defaultProps` on function components removed | No — TypeScript throughout |
| String refs removed | No — none |
| `ReactDOM.render` / `hydrate` / `findDOMNode` removed | No — App Router |
| `react-dom/test-utils` `act` moved to `react` | No — no render tests exist (§The blind spot) |
| **`useRef` now requires an argument** | **No — verified: zero `useRef()` calls with no argument** |
| **Ref callbacks must not return a value** | **No — verified: 3 ref callbacks, all block-bodied (`ref={(x) => { … }}`), none implicit-return** |
| `element.ref` deprecated in favour of `element.props.ref` | No — not accessed |
| Uncaught errors → `window.reportError` instead of re-throw | Cosmetic; changes what appears in the console |
| **StrictMode: `useMemo`/`useCallback` reuse first-render results** | **YES — and it is load-bearing. See the R3F section** |
| **Suspense: fallback commits immediately, siblings pre-warm after** | **YES — the highest-risk item in this document** |

### Why the Suspense change is the risk

React 19 changed the rule to: *"when a component suspends, React will
immediately commit the fallback of the nearest Suspense boundary without waiting
for the entire sibling tree to render. After the fallback commits, React
schedules another render for the suspended siblings to 'pre-warm' lazy requests
in the rest of the tree."*

This repo does not merely use Suspense. It **builds its loading choreography on
the precise timing of Suspense**, and says so in its own comments:

- `features/scene-renderers/registry.ts` uses `React.lazy` **deliberately
  instead of `next/dynamic`**, with a comment explaining that `next/dynamic`
  *"does not suspend"*, which would let the ready-signal mount early, *"lift the
  opacity veil and show an empty canvas until the chunk landed."*
- `components/UniverseCanvas.tsx` mounts `SceneReadySignal` **inside** the same
  Suspense boundary so that its first `useFrame` means *"textures resolved and
  pixels are on screen"* — the moment the canvas may fade in.
- Suspending inside that boundary comes from **three independent sources**: the
  lazy renderer chunk, `useGLTF`/`useTexture` (drei), and `useLoader` (R3F) —
  used across 8+ components.

A change to *when the fallback commits relative to sibling rendering* is exactly
the kind of change that turns "fade in when the scene is ready" into "fade in
over an empty canvas, then pop". It will not fail typecheck. It will not fail a
unit test. **It is visible only to a human looking at a loading screen**, or to a
screenshot taken at the right moment.

This is the single item that most deserves a manual, deliberate, both-families,
desktop-and-mobile verification pass.

---

## React Three Fiber v8 → v9: what actually applies

From the official v9 migration guide, item by item:

| v9 change | Applies here? |
| --- | --- |
| Global JSX namespace → `ThreeElements` interface | **No — verified: the repo never calls `extend()` and declares no custom elements.** This is the change most v9 migration write-ups lead with, and it costs this repo nothing |
| `Props` renamed to `CanvasProps` | No — not imported |
| Hardcoded `MeshProps` / `Object3DNode` exports removed | **No — verified: zero occurrences** |
| `useLoader` accepts loader instances | Additive |
| `gl` callback may return a promise | Additive |
| **Automatic sRGB conversion of texture props removed** | **No — and this is the good news below** |
| **StrictMode now properly inherited from the parent** | **YES — the real work** |

### The scariest change costs nothing here, and the reason is in the repo

"Automatic sRGB conversion of texture props has been removed" is a **silent
colour regression** for most apps: every colour map loaded through `TextureLoader`
suddenly samples as linear, and the whole scene goes washed-out and flat.

This repo already fought that battle and won it the hard way. From
`features/scene-renderers/shared/textureQuality.ts`:

> *"three's `TextureLoader` leaves textures in `NoColorSpace`, so our
> sRGB-encoded JPGs were being sampled as if linear — washed-out, low contrast.
> Color maps must be tagged `SRGBColorSpace` (data maps — normal, roughness,
> alpha — must NOT be)."*

`applyColorTextureQuality()` sets `texture.colorSpace = SRGBColorSpace`
explicitly, and it is called at **every** `useLoader(TextureLoader, …)` colour
site — `BinarySun.tsx`, `Skybox.tsx`, `SolarPlanet.tsx`, `Sun.tsx`. Procedural
textures set it too (`gasGiantTexture.ts:228`, `planetRingTexture.ts:95`), and
`ForestTerrain.tsx:221` sets `NoColorSpace` on the relief map on purpose. The
only `useTexture` call loads a **normal map and an ARM map** — data maps, which
must not be sRGB in either version.

**The app never depended on the automatic conversion, so removing it changes
nothing.** That is a direct, evidence-backed answer to *"các hàm quan trọng có
tái sử dụng được không"* for the most dangerous single item on the list.

### What does cost work: StrictMode reaching inside the Canvas

`next.config.mjs` sets `reactStrictMode: true`. Under R3F v8, StrictMode was
**not** inherited into the `<Canvas>` subtree, so none of the scene renderers
have ever run under it. v9 fixes that — and the guide's own words are that it
*"may expose side-effect bugs"*.

Combine that with React 19's StrictMode rule — *"`useMemo` and `useCallback`
will reuse the memoized results from the first render during the second
render"* — and one specific pattern in this repo becomes hazardous:

```tsx
const rockGeometries = useMemo(() => [...], [seed]);   // created once
useEffect(() => {
  return () => { rockGeometries.forEach((g) => g.dispose()); };  // disposed on cleanup
}, [rockGeometries]);
```

The StrictMode sequence is mount → cleanup → mount. The cleanup **disposes** the
geometry; the second mount **reuses the same memoized object**, now disposed.
The mesh then renders against a dead `BufferGeometry`.

The exact sites, found by grep — this is the complete list:

- `solar-system/AsteroidBelt.tsx:234` — `rockGeometries.forEach(g => g.dispose())`
- `solar-system/Comet.tsx:204` — `nucleusGeometry.dispose()`
- `solar-system/ProceduralMoons.tsx:119` — `geometry.dispose()`
- `solar-system/SolarPlanet.tsx:246` — `ringGeometry?.dispose()`
- `solar-system/SolarPlanet.tsx:262` — `proceduralRingGeometry?.dispose()`

**Stated honestly, and this matters for how much to panic:** StrictMode's
double-invocation is **development-only**. Production builds do not double-mount,
so this cannot take the live site down. What it can do is make `npm run dev`
look catastrophically broken across the whole solar-system family, at exactly
the moment the team is least sure whether the upgrade or their own code is at
fault — and send someone "fixing" things that were never wrong. Budget time for
it; do not budget fear.

The remedy is standard and small: allocate in a `useRef`/lazy initialiser rather
than `useMemo`, or drop the disposal effect and let R3F's own disposal handle it.
Five files.

### Per-file verdict for the 3D layer

| Group | Files | Verdict |
| --- | --- | --- |
| Uses only `useFrame` / `useThree` / `ThreeEvent` | ~20 | **Unchanged.** No v9 item touches these APIs |
| Uses `useGLTF` / `useTexture` / `useAnimations` | 8 | **Unchanged in code**, but re-verify visually — they are the Suspense sources |
| Raw GLSL `<shaderMaterial>` | `SizedStarPoints.tsx`, `NebulaCloudPoints.tsx` | **Unchanged.** GLSL is untouched under `WebGLRenderer`; only a WebGPU move would touch them |
| `onBeforeCompile` shader injection | `forest/forestModels.ts` | **Unchanged by R3F v9 — but the most fragile file in the repo across a three.js bump.** See below |
| `useMemo` + dispose-in-cleanup | the 5 sites above | **Needs thought** — the StrictMode item |
| `PostEffects.tsx` (8 effects) | 1 | **Version-pin decision**, not a code edit — see Trap 1 |

**Roughly 30 of ~35 3D files need no edit at all.** That is the honest answer to
the reuse question, and it is a much better answer than the migration's
reputation suggests.

### The one file that can fail silently and take the forest with it

`features/scene-renderers/forest/forestModels.ts:279` does not write its own
shader. It **patches three.js's built-in one**:

```ts
material.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    [ "#ifdef USE_MAP",
      "  vec4 sampledLeafColor = texture2D( map, vMapUv );",
      /* … collapse to luminance, remap, multiply onto instance colour … */ ].join("\n")
  );
};
```

This depends on two **internal** details of three.js: the chunk name
`#include <map_fragment>` and the varying `vMapUv`. Neither is public API.
Neither is covered by semver.

The failure mode is what makes it dangerous. `String.prototype.replace` with no
match **returns the original string and throws nothing**. If a future three.js
renames the chunk or the varying, the injection silently becomes a no-op, the
foliage loses its seasonal recolouring, and the app builds clean, typechecks
clean, passes all 217 tests and deploys green — with the forest family's leaves
quietly the wrong colour.

Two consequences:

1. **This is the strongest single argument for the screenshot baseline**, and
   for keeping the three.js bump on its own PR. It is exactly the class of bug
   nothing in this repo's CI can see.
2. **It is a hard blocker for WebGPU**, not merely work. `onBeforeCompile` on a
   built-in material is a `WebGLRenderer` mechanism; under `WebGPURenderer` the
   equivalent is a TSL node graph, which is a rewrite of the technique rather
   than a translation of the shader. Track D counted this file as "rewrite in
   TSL" and was right to.

A cheap defence, worth more than its size: make the replacement assert it
matched. Three lines, and it converts a silent visual regression into a loud
console error the moment three.js moves underneath it.

---

## three.js 0.171.0 → 0.185.1: the guide, read against the source

Fourteen minor releases, ~19 months. This was flagged as the highest silent-risk
item in the plan, so it was closed the same way the rest was: the official
migration guide read verbatim, then every entry checked against what this repo
actually calls.

Of roughly fifty entries across the range, **four touch this repo, and one of
them matters a great deal.**

| Release | Entry (verbatim) | Applies here |
| --- | --- | --- |
| **r180 → r181** | *"The way indirect specular light for PBR materials is computed has been improved."* · *"PBR materials now better conserve energy."* · *"PMREM reflections have been improved."* | **YES — the one that matters.** See below |
| **r181 → r182** | *"`PCFSoftShadowMap` with `WebGLRenderer` is now deprecated."* | **YES.** `UniverseCanvas.tsx:168` sets `shadows={isForestFamilyScene ? "soft" : false}`, and R3F's `"soft"` *is* `PCFSoftShadowMap`. Deprecated, not removed — a console warning now, a decision later, and only the forest family |
| **r183 → r184** | *"The background and environment map rotation has been aligned."* | **Possibly.** Both families light entirely through `<Environment>`; neither sets a rotation, so probably nothing moves — but "probably" in an environment-lit app is a screenshot question |
| **r184 → r185** | *"`Object3D.updateWorldMatrix()` now honors the `Object3D.matrixWorldNeedsUpdate` flag."* | No — never called |

### Why r181 is the whole risk

Three entries in one release change how lit surfaces resolve: indirect specular,
energy conservation, and PMREM. This repo is maximally exposed to all three:

- **13 files** use `MeshStandardMaterial` / `MeshPhysicalMaterial` — the PBR
  materials the entry names.
- **Both families are lit by PMREM environments.**
  `ForestRenderer.tsx:136` mounts `<Environment files={natureHdriUrl…}
  environmentIntensity={…} />`; `SpaceEnvironment.tsx:35` mounts `<Environment
  frames={1}>` and bakes `Lightformer` rects into a cubemap. There is no
  fallback lighting path that avoids this.

So the expected outcome of the three.js bump is not a crash. It is **every lit
surface in the product looking slightly different** — quite possibly better,
since the change is an improvement — with nothing in the repository able to
tell anyone it happened. This is the concrete instance of the abstract warning
in §The blind spot, and it is the reason step 6 of the sequence exists as its
own PR.

### The things that would have hurt, verified not to

Each of these was a live worry before it was checked:

- **`forestModels.ts` survives.** Its `onBeforeCompile` patch depends on the
  chunk `#include <map_fragment>` and the internal varying `vMapUv`. The actual
  file `src/renderers/shaders/ShaderChunk/map_fragment.glsl.js` was fetched at
  **both `three@0.171.0` and `three@0.185.1`** and is **unchanged** — same
  `#ifdef USE_MAP`, same `texture2D( map, vMapUv )`. The silent-no-op scenario
  does not fire in this range. (It remains a good reason to add the
  match-assertion anyway, for the range after this one.)
- **`AgXToneMapping` still exists**, still value `6`, and `UniverseCanvas.tsx:173`
  passes it in the `gl` config. `SRGBColorSpace`, `LinearSRGBColorSpace` and
  `NoColorSpace` are unchanged — verified from `src/constants.js` at 0.185.1.
- **r177 → r178** — *"`MultiplyBlending` and `SubtractiveBlending` now require
  `Material.premultipliedAlpha`"* — does not apply. Verified: **zero**
  occurrences of either. The repo uses `AdditiveBlending` (10 files) and
  `NormalBlending` (1).
- **r182 → r183** — *"A legacy gamma correction of `Sky` and `SkyMesh` has been
  removed"* — does not apply. `ForestSkyDome` is this repo's own component, not
  three's `Sky` addon. No `three/addons` import exists anywhere in `src/`.
- **r175 → r176** `CapsuleGeometry` rename, **r176 → r177** `ColorManagement`
  method renames, **r179 → r180** `RGBELoader` → `HDRLoader` — none used
  directly; drei owns the HDR loader.

### One correction in the other direction

Track D's claim that the installed three.js already carries the WebGPU entry
point is **right**, and an earlier draft of this document nearly "corrected" it
into a fourth error. Verified from the package manifest: `three@0.171.0`
declares `exports` of `./webgpu` and `./tsl`, exactly as 0.185.1 does. What
remains unestablished is not whether the entry point exists but whether it is
production-ready and whether its WebGL2 fallback is complete — a different
question, still open.

---

## The blind spot: nothing in CI can see the scene

This is the finding that should govern the plan, and it has nothing to do with
any library version.

- **217 unit tests across 20 files.** All of them test pure modules: seeded
  math, scene derivation, routing, form state, the audio graph, API shaping.
- **Zero component-render tests.** Verified: no `@testing-library`, no
  `render(` anywhere in `src/`.
- **Zero end-to-end or visual tests.** Verified: no Playwright anywhere in the
  repository.
- CI for the web app runs `typecheck`, `lint`, `test`, `build` — **all four are
  blind to what the canvas draws.**

So the suite is excellent at protecting **exactly the code that cannot break in
this migration** (pure TypeScript, no React, no three.js) and provides **zero
coverage of the code that will** (components, Suspense timing, GPU resources,
post-processing, colour).

Two consequences follow, and they are not optional:

1. **A green CI run means nothing here.** It will be green through a scene that
   renders black, a veil that lifts early, washed-out colour, or bloom that
   blew out. Treating green as a go signal is the specific way this migration
   ships a broken product.
2. **The cheapest real mitigation is a screenshot pass, not more unit tests.**
   A handful of Playwright screenshots — solar system and forest, desktop and
   375 px, before and after — would turn every silent risk in this document
   into a visible diff. That work is worth more than any single version bump
   here, and it is worth doing **before** the upgrade, so there is a baseline
   to compare against. A baseline captured after the upgrade proves nothing.

---

## WebGPU: an honest verdict

### Verified browser reality, 2026-08-12 (caniuse)

**85.56 % global support.** Chrome 113+, Edge 113+, Samsung Internet 24+,
Opera 99+.

But the detail matters more than the headline:

- **Firefox is still disabled by default** — through version 156 on desktop and
  153 on Android. Not "shipped in 141" as this repo previously recorded.
- **Safari on macOS shows only partial support even at 26.0+.** iOS Safari
  26.0+ is full.
- The 85 % is carried almost entirely by Chromium.

For a public, link-shared product — and share links are a core feature here —
"most visitors, plus a fallback path that must be exercised on the rest" is the
accurate framing, not "supported".

### The verdict, now with the evidence it was missing

Track D's verdict — low return today, do it last, behind a flag — survives. But
it survived for weak reasons (scene complexity, bundle size), and the strong
reason was never established. It is now, and it is much harder:

> **three.js's own manual lists `ShaderMaterial`, `RawShaderMaterial`,
> `onBeforeCompile` and `EffectComposer` as NOT supported under
> `WebGPURenderer`.**

That single sentence names **every custom-rendering technique this repository
owns**: the 2 raw-GLSL `<shaderMaterial>` files, the `onBeforeCompile` patch in
`forestModels.ts`, and all 8 post-processing effects. Verbatim from the manual:

> *"`EffectComposer` with its effect passes are not supported because
> `WebGPURenderer` comes with a new, more modern post-processing stack. Similar
> to materials, post-processing effects are now written in TSL and the effect
> chain is expressed as a node composition."*

And the manual still labels `WebGPURenderer` itself **experimental** as of r185.
So Track D's *"ships WebGPURenderer as production-ready"* was half wrong in the
most dangerous way: the automatic WebGL2 fallback half is **true and
documented**, which lends credibility to the "production-ready" half, which the
manual contradicts.

**The post-processing path is closed, not merely rough.** `@react-three/postprocessing`
wraps pmndrs `postprocessing`, which has no WebGPU code — verified by grepping
the *published* v7 beta bundle: zero bytes matching `webgpu`. Its maintainer's
position (2024, re-affirmed by closing two later duplicates) is that they will
move *"when `WebGPURenderer` officially replaces the `WebGLRenderer`"*. Passing
a `WebGPURenderer` to `EffectComposer` **throws** rather than degrading. And
`n8ao` — one of the 8 — states in its own README that it is not WebGPU
compatible, a milestone its 2.0 release passed without delivering.

**The R3F and drei WebGPU entry points are unreleased alphas.** `@react-three/fiber`
`10.0.0-alpha.3` and `drei` `11.0.0-alpha.5`. drei's v11 (WebGPU) milestone sits
at 44 open / 29 closed, **seven months past its due date**, and drei issue #2764
is a broken import in the **CubeCamera/Environment path** of the `/webgpu` entry
— which is precisely what both of this app's families use for lighting. R3F
issue #3846 (a Turbopack blocker on the WebGPU entry) is open with **zero
maintainer comments**.

### What it would actually cost, priced honestly

The first draft of this section was too pessimistic in one place and too
optimistic in another. Corrected:

| Surface | Cost |
| --- | --- |
| 2 raw-GLSL `<shaderMaterial>` files | **Not full rewrites.** three.js ships an official transpiler at `three/addons/transpiler/Transpiler.js` with a live tool. Community reports say it leaves GLSL-only names and chokes on `#define`, so budget hand cleanup — but paste them in first and get a real signal in under an hour |
| `forestModels.ts` `onBeforeCompile` | **A genuine rewrite.** The transpiler has no model of three's chunk system; this becomes a node-material composition |
| Bloom, ChromaticAberration | Direct TSL nodes exist |
| HueSaturation | `hue()` / `saturation()` exist in three **core**, but as loose functions, not a drop-in effect |
| N8AO → `GTAONode` / `SSAONode` | **A different AO algorithm.** Expect a different look; this needs an art-direction decision, not a port |
| Vignette, BrightnessContrast, Noise | No named nodes. Hand-written TSL — trivial maths, but hand-written |
| Container API | `PostProcessing` was **renamed to `RenderPipeline` in r183**; write against `RenderPipeline`. Neither exists in the installed `three@0.171.0` |

So: **~5 drop-ins, 3 hand-written passes, 3 shader surfaces, one art-direction
call — on top of an alpha renderer, an alpha R3F entry point, and a drei entry
point with a live crash in the exact component this app lights through.**

### The framing that should go in the roadmap

Not *"WebGPU: blocked"* — that is a false technical premise, because
`WebGPURenderer` genuinely does fall back to a WebGL2 backend, so device support
is not the risk. The accurate framing is:

> **WebGPU: requires rewriting the post-processing stack and all three custom
> shader surfaces. Deferred on cost, not on feasibility. Re-open when drei ships
> a stable v11 with a working `/webgpu` entry.**

And the pre-existing reasons still hold and still come first:

- The scenes are procedural, low-poly and already instanced — nowhere near the
  draw-call or compute ceilings where WebGPU wins.
- The measured bottleneck is **bundle size and cold start**, which WebGPU does
  not improve.
- **Seeded determinism is a product promise** — *"same seed, same scene,
  forever"*. Every share link ever issued is a claim about pixels, and a
  renderer swap that shifts a float breaks that claim retroactively.

One benchmark worth not over-reading in either direction: a team publicly
reported moving *back* to `WebGLRenderer` over ~20 s TSL compile times, and
three.js later landed a ~3× compile improvement in r184 — but that fix shipped
*before* the article, so it cannot be waved away as a stale snapshot. Both are
other people's workloads. If compile cost ever decides this, measure it on these
two scenes.

---

## Vercel: the platform constraints that actually bind

Researched because "we can always roll back" was doing a lot of unexamined work
in the plan. It is true, and thinner than it sounds.

### The safety net is exactly one step deep

**Instant Rollback exists on Hobby**, and it is instant. It rolls back to the
**immediately previous production deployment** — one step, not a history.

The failure mode writes itself: deploy the migration, notice something wrong,
push a fix on top, and now *"the previous deployment"* is the broken migration,
not the known-good Next 14 build. **The rollback window can close after a single
push**, in an app where nothing in CI can see the canvas and the defect is
therefore likely to be found by a human some time after the deploy.

Two further behaviours to know before, not during, an incident:

- **After a rollback, Vercel disables auto-assign of the production domain.**
  Pushing to `main` afterwards deploys nothing to production until someone
  clicks Undo Rollback. A team that rolls back at night and pushes a fix in the
  morning will watch a fix that never arrives.
- **Environment variables are not rolled back.** They stay at their current
  project-settings values.

The discipline that follows is cheap: **one deploy, one observation.** Record
the known-good deployment id first. After promoting, do not push again until
both scenes have been checked by eye on the production URL. If a fix is needed,
roll back *first*, then fix on a preview.

There is also a staging workflow the repo is not using and should:
Settings → Environments → Production → Branch Tracking → turn off *Auto-assign
Custom Production Domains*. The build then sits **Staged** at its own URL, gets
looked at, and is promoted deliberately. For a 3D app with no automated visual
check, that is the closest thing to a pre-flight inspection available on this
tier.

### A deadline that is already inside the planning horizon

**Vercel retires Node 20 on 2026-10-01** — about seven weeks out. And the
repo cannot tell anyone which version it is on: there is **no `engines.node`
and no `vercel.json`**, so the Node version lives only in a dashboard setting
that no code review can see. CI runs Node 24; Vercel may be running whatever
the project was created with.

If it is pinned to 20.x, then after that date **every new deployment fails,
including an emergency hotfix.**

Fix it before touching Next at all: read Settings → Build and Deployment →
Node.js Version, then add to `apps/myunivokai-web/package.json`:

```json
"engines": { "node": "24.x" }
```

That overrides the dashboard, matches CI, and turns an invisible setting into a
reviewable line of git.

### `output: "standalone"` should go, on its own commit

Vercel traces files itself with `@vercel/nft` and **never reads
`.next/standalone`**. The option makes the build copy a second traced
`node_modules` for nothing — build time and disk, on a Hobby builder, for a
heavy 3D app. Remove it as a **separate commit, deployed and confirmed before
the Next upgrade starts**, so that if anything moves, it is unambiguous what
moved. (Keep it only if something still builds a Docker image from this app;
nothing appears to.)

### Turbopack, and a Hobby-tier failure mode

Hobby allows **one concurrent build** with a **45-minute hard cap** that cannot
be raised. There is a community report (2026-07-19) matching this app's exact
shape — Hobby, Next 16.2.x — of a build hanging silently at *"Running
TypeScript…"* until it was killed at 45 minutes, with no Vercel response and no
fix. This repo has many heavily-typed 3D `.tsx` files.

Nothing about the repo is *technically* Turbopack-hostile: no `webpack()` config
and GLSL lives in template literals, not loaders. But the mitigation is free, so
take it: if Next 16 happens, set `"build": "next build --webpack"` **from the
start**, and remove that flag later as its own independent change. Otherwise a
bundler swap and a framework swap fail as one indistinguishable event, and a
hung build blocks the entire deploy queue.

### The real Hobby ceiling is bandwidth, and there is dead weight in it

`public/` is **68 MB**. Hobby allows 100 GB Fast Data Transfer per month —
roughly 1,470 full cold loads.

Verified on disk, and actionable regardless of any upgrade:

```
14.66 MB  public/assets/nature/models/experimental/dirt-road-through-forest.glb
 1.73 MB  public/assets/nature/models/experimental/wetland-shoal-river.glb
```

**Neither is referenced anywhere in `src/`** — verified by grep. They are
leftovers from the abandoned baked-scene direction. The larger one also exceeds
the **10 MB CDN cache limit**, so any request for it goes to origin every time,
against a Fast Origin Transfer allowance of only ~10 GB/month.

Deleting that directory removes **~16 MB from every deployment** and costs
nothing. Separately, five 8K/4K solar-system JPGs total over 15 MB and are
obvious WebP/AVIF/KTX2 candidates — a bandwidth question, not a migration one.

### There is no "supported versions" policy — there is CVE-based deploy blocking

Vercel publishes no supported-Next-versions policy. The actual enforcement
mechanism is **blocking deploys of versions with specific CVEs**, which has been
used at least twice. Next 14.2.23 is not blocked today. But the block list only
grows, and the 14.x line is carrying unpatched advisories with no patched
release.

So *"Next 14 keeps deploying indefinitely"* is not a safe planning assumption.
The day a 14.x CVE is added is the day hotfixes stop shipping too. An escape
hatch env var exists; treat it as a one-time release valve, never a plan.

One more, small but sharp: **Hobby runtime logs are retained for one hour.** If
the migration fails in a way that only real traffic reveals, the evidence
evaporates before anyone investigates. Deploy while present, watch for the first
hour, and copy anything odd out immediately.

### And a licensing question that is not a technical one

Hobby is **non-commercial only**. If myunivokai has any commercial dimension —
sales, ads, paid hosting, even donations — Hobby is the wrong plan independent
of this migration. Worth noting that Pro also fixes two items above: rollback to
**any** past production deployment instead of one step, and a larger build
machine. For the migration month alone, that is a defensible purchase.

---

## Corrections to `platform-evolution-research.md` §Track D

Three statements there are wrong and should not be planned against:

| Track D says | Verified reality |
| --- | --- |
| "three.js **r171** (September 2025)" | `three@0.171.0` was published **2024-11-29**. Off by ~10 months, which also makes the version sound far fresher than it is — it is now 14 minors behind |
| "Browser support: Chrome 113+, **Firefox 141+**, Safari 26" | Firefox is **disabled by default** through 156 desktop / 153 Android (caniuse, 2026-08-12) |
| "`three` — **unchanged**, already sufficient" | True only with `@react-three/postprocessing@3.0.4`. With `3.0.5` (`latest`) the peer floor is `three >= 0.182.0`, forcing an 11-minor bump |
| "`next` — 3 high advisories" | **8 high** in `myunivokai-web` today, of which the `next` entry alone aggregates **21 advisories** |

Track D's shader inventory, on the other hand, was right to list
`forest/forestModels.ts` — and understated it. See the next section.

---

## Two candidate routes

### Route A — Next 15.5.23, one major hop *(recommended)*

```
next            14.2.23 → 15.5.23
react/react-dom 18.3.1  → 19.2.x
@react-three/fiber      8.18.0 → 9.7.0
@react-three/drei       9.122.0 → 10.7.8
@react-three/postprocessing 2.19.1 → 3.0.4   ← pinned, NOT latest
three                   0.171.0 (unchanged)
eslint / eslint-config-next     8.x (unchanged — 15.5.23 accepts ^8 || ^9)
tailwindcss             3.4.17 (unchanged)
```

- Closes **all 21** `next` advisories — every request-path CVE. Leaves the
  build-time `postcss`/`nanoid` pair; see §The catch.
- Lands `myunivokai-web` on **the exact stack `myunivokai-admin` already runs**,
  which collapses two toolchains into one and gives the team a working reference
  implementation inside its own repo.
- Keeps sync `params` legal (deprecated, dev warning) — so the three-file change
  can be made deliberately rather than under build-failure pressure.
- **Does not** move to Turbopack, does not touch ESLint, does not touch
  Tailwind, does not touch three.js. Every one of those becomes a separate,
  separately revertible change.
- Remaining work is then exactly: async `params` (3 files) + the StrictMode
  dispose pattern (5 files) + a visual verification pass.

**Pin exactly; do not use carets on the 3D stack.** `fiber@9.7.0` declares
`react: ">=19 <19.3"`, so `^19.2.8` would eventually resolve past the supported
range on someone's `npm install` months from now. And go **straight to 9.7.0** —
it is the first release carrying both the `act` fix from 9.1.1 and the import
fix from PR #3807 (landed 2026-07-30, one day before 9.7.0). Never pin an
intermediate 9.x.

```
react 19.2.8 · react-dom 19.2.8 · @react-three/fiber 9.7.0
@react-three/drei 10.7.8 · @react-three/postprocessing 3.0.4 · three 0.171.0
```

**A tempting sequencing that should be rejected.** Both `next@15.5.23` and
`next@16.3.0` declare `react: "^18.2.0 || ^19.0.0"`, which suggests Next could
be upgraded on React 18 first, as an independently revertible deploy, before the
React 19 + 3D bump. The peer range permits it; **the documentation forbids it**
— the official Next 15 guide states *"The minimum versions of `react` and
`react-dom` is now 19"*, and Next 16's App Router is documented as running on
React 19.2 features. With 49 of 52 files under the App Router, that loose peer
range is Pages-Router tolerance, not permission. Splitting this way trades one
reviewed risk for an undocumented configuration.

### Route B — Next 16.3.0, both hops at once

Everything in Route A, plus: sync `params` becomes fatal, Turbopack becomes the
build tool, `next lint` disappears, ESLint must move to 9 + flat config, and the
`First Load JS` metric the team optimises against stops being printed.

It also does one thing Route A cannot: it replaces `next`'s pinned
`postcss@8.4.31` with `8.5.23`, which is the only way to make
`npm audit --omit=dev --audit-level=high` exit 0.

Route B is not unreasonable — the repo has no custom webpack config, which
removes Turbopack's main failure mode, and Node 24 and TS 5.7 already satisfy
the floors. It is simply **more simultaneous unknowns in the one app with no
visual test coverage**, in exchange for closing a build-time advisory with no
attacker path in this deployment.

**Recommendation: Route A now, Route B on its own PR once a screenshot baseline
exists to verify it against.** If the owner would rather satisfy
`S1-SECURITY-001` literally in one move, Route B is defensible — but then the
screenshot baseline stops being optional, because Route B changes the bundler,
the linter and the framework in the app nothing can visually test.

### Suggested order, either route

**Step 0 — four things that are cheap, independent of the upgrade, and reduce
its risk. Each its own commit, deployed and confirmed before the next.**

- Read Vercel → Settings → Build and Deployment → **Node.js Version**, then add
  `"engines": { "node": "24.x" }`. The 2026-10-01 Node 20 retirement is inside
  the planning window and would block hotfixes, not just upgrades.
- Remove **`output: "standalone"`** from `next.config.mjs` — Vercel ignores it
  and pays for it.
- Delete **`public/assets/nature/models/experimental/`** — ~16 MB of `.glb`
  referenced by nothing, one file of which busts the CDN cache limit.
- Turn off **auto-assign of the production domain** so production builds land
  Staged and are promoted by hand. This is the only pre-flight inspection this
  tier offers.

Then:

1. **Playwright screenshot baseline, on the current stack.** Both families,
   desktop + 375 px, loading state and settled state, animation paused at fixed
   camera positions. Without this step nothing below can be verified, only
   hoped.
2. Async `params` — 3 files. Safe on 14, so it can land and merge alone.
3. The version bump, pinned exactly as above. On Route B, set
   `"build": "next build --webpack"` in the same commit and remove it later
   as its own change — otherwise a bundler swap and a framework swap fail as
   one indistinguishable event.
4. Fix the five StrictMode dispose sites.
5. Re-shoot the screenshots. Diff. **Look at the images**, do not read the
   markup. Promote deliberately, then **do not push again** until both scenes
   have been checked on the production URL — the Hobby rollback window is one
   deployment deep and a second push closes it.
6. Only then: three.js 0.171 → 0.185, on its own PR, re-shooting again. The
   specific thing to look at is **lighting on every PBR surface in both
   families**, because r181 changed indirect specular, energy conservation and
   PMREM at once, and this app is lit entirely through PMREM environments.
   Expect a difference; decide whether it is an improvement. Add the
   match-assertion to `forestModels.ts` while in there — it is safe across
   *this* range, verified, but the next range is not covered by that check.
7. Only then, and only if there is a reason: Next 16, and after that WebGPU
   behind a `navigator.gpu` flag.

Rollback, at every step: Vercel keeps previous deployments and can promote one
back. That is the real safety net, and it argues for **small, separately
promotable deployments** rather than one heroic PR — which is the same argument
as the repo's own *"one concern per PR"* rule, applied to risk instead of review.

---

## What must not happen

- **`npm audit fix --force`.** It installs `next@16.3.0` and
  `eslint-config-next@16.3.0` in one unreviewed step, on the reasoning that
  `latest` is the fix. The minimum sufficient fix is `15.5.23`.
- **Taking `@react-three/postprocessing@latest` without thinking.** It silently
  drags three.js forward 11 minors inside a React upgrade, and three.js minors
  change how things look, not whether they compile.
- **Treating a green CI run as verification.** Typecheck, lint, 217 unit tests
  and a successful build are all blind to the canvas.
- **Upgrading and screenshotting afterwards.** A baseline taken after the change
  proves the app renders; it cannot prove it renders *the same*.
- **Doing the three.js bump in the same PR as the React bump.** If the colours
  shift, there would be no way to tell which change did it.
- **Starting with WebGPU.** It is last, it is flagged, and it is gated on a
  visual baseline existing.

---

## What executing it actually found — 2026-08-14

Route A shipped on `feat/fe/next-15-react-19`. Five of this document's claims
did not survive contact with the code, and they are recorded here rather than
edited away, because a research document that only keeps its wins teaches
nobody where to be careful next time.

**1. `use(params)` is NOT safe on Next 14, and the plan says it is.** §Suggested
order, step 2 reads *"Async `params` — 3 files. Safe on 14, so it can land and
merge alone."* That holds for the two share pages, which `await` — a
non-Promise awaits fine. It is false for `worlds/[worldId]`, which is
`"use client"` and therefore uses React's `use`: on 14 `params` is a plain
object, and `use()` throws *"An unsupported type was passed to use()"* at
runtime. Build, lint, typecheck and 259 tests all pass; the page is dead.

**This is the single most dangerous sentence in the document**, because it
invites shipping that commit alone, and every automated gate agrees it is fine.
The correction: async `params` and the version bump are **one deployment**. They
may be separate commits for review, never separate deploys.

It was found by the screenshots, which is exactly what they were added for —
though not the way anyone expected. Playwright reused a still-running Next 14
server, so the "after" run was really an "async params on 14" run, and it failed
on the one page that matters.

**2. `output: "standalone"` must stay.** §`output: "standalone"` should go says
*"Keep it only if something still builds a Docker image from this app; nothing
appears to."* Something does: `apps/myunivokai-web/Dockerfile.prod` copies
`.next/standalone`, and `render.yaml` still carries the (commented) web service
block that would build it. Removing the option to save Hobby build time would
break a Dockerfile in the same change as a framework major. Not done.

**3. The five StrictMode dispose sites needed no edit.** §What does cost work
prices them as work and calls for five files changed. Driven against a dev
server with StrictMode active — the only place a double mount happens — the
solar system renders complete, planet rings and procedural moons included, zero
console errors. `BufferGeometry.dispose()` releases the GPU buffer and leaves
`attributes` in JS memory, so the next frame re-uploads. The hazard is real in
shape and absent here. Five speculative edits were not made.

**4. Four 3D files DID need an edit this document does not mention.**
§Per-file verdict puts `<bufferAttribute>` users under "unchanged". They are
not. R3F v9 treats `array`/`itemSize` as **constructor arguments** —
`args={[array, itemSize]}` — and derives `count`; the old three-prop form
builds an attribute with no data. Twelve attributes across `SizedStarPoints`,
`ConstellationField` and `NebulaCloudPoints`. v9's types are what caught it,
which is an argument for typecheck over faith.

**5. `sharp` joined the advisory list, and the catch is smaller than feared.**
After the bump `npm audit` reports three high advisories and **none against
`next` itself**: `postcss@8.4.31` and `sharp@0.34.5`, both pinned inside next's
own tree. §The catch anticipated postcss. It could not anticipate sharp, and the
answer is the same shape: `next/image` appears exactly once in this app, with
`unoptimized`, so the Image Optimizer that loads sharp never runs.

What did survive, and is worth saying plainly: **the version numbers, the
pinning advice and the risk ranking were right.** 15.5.23 does clear all 21
advisories. `postprocessing` did have to be pinned at 3.0.4 — 3.0.5 raises its
`three` peer to `>=0.182.0`. And the instruction to build a visual baseline
first was the most valuable sentence in the document; without it, finding 1
would have been found by a user.

---

## Research provenance, and what is still open

The first parallel research run for this document lost all eight agents to an
account session limit and returned nothing; the sections above were written from
the npm registry, the official upgrade guides, caniuse and this repository read
directly. A second, narrower run then closed the four remaining gaps, each
finding checked by an independent adversarial pass. **Those checks overturned
several of their own researchers' claims, which is the reason to trust the
survivors and the reason to record the corrections here.**

### Closed

| Was open | Outcome |
| --- | --- |
| three.js r171 → r185 migration entries | **Closed.** §three.js 0.171.0 → 0.185.1. Four entries apply; r181's PBR/PMREM change is the real one; `forestModels.ts` verified safe by diffing the actual shader chunk at both versions |
| `@react-three/postprocessing` under `WebGPURenderer` | **Closed — it does not work, and cannot today.** §WebGPU |
| `WebGPURenderer` production status and fallback completeness | **Closed.** Still labelled experimental in three.js's own manual at r185; the WebGL2 fallback is real and documented |
| R3F v9 / drei v10 field reports | **Closed.** drei v10's entire breaking-change list is one line ("React 19 support"); go straight to `fiber@9.7.0` and pin it |
| Vercel Node runtime, `standalone`, Hobby build limits, rollback | **Closed.** §Vercel — and the rollback finding changed the plan |

### Corrections made during verification

Recorded because each was believed for a while, and because they show what an
unchecked research pass produces:

- *"There is no automated GLSL → TSL path"* — **wrong.** three.js ships
  `three/addons/transpiler/Transpiler.js` and a live tool. Only the
  `onBeforeCompile` file is a true rewrite.
- *"R3F v9 broke Webpack production builds through 9.1.1"* — **wrong and
  inverted.** 9.1.1 is the *fix*, and the maintainer's note names **rsbuild**,
  not Webpack and not Next.js. The conclusion (go to 9.7.0) survives by a
  different route.
- *"WebGPU should be removed from the roadmap"* — **does not follow.**
  `WebGPURenderer` falls back to WebGL2, so device support is not the risk. It
  is a rewrite-cost decision.
- *"Maintainers have responded to the R3F Turbopack blocker"* — **wrong.** Zero
  comments, which is a worse signal than reported.
- *"three@0.171.0 predates the `three/webgpu` entry point"* — **wrong**, and
  nearly written into this document. The package manifest declares it.

### Still open

| Open item | Why it matters | How to close it |
| --- | --- | --- |
| Which **Node version this Vercel project is actually pinned to** | Invisible in git; the 2026-10-01 Node 20 retirement would block hotfixes | Read it in the dashboard — **step 0 of the plan**, not research |
| Whether Vercel has added the 2026 Next CVEs to its **deploy block list** | If it has, the upgrade stops being schedulable | Attempt a deploy, or watch the changelog |
| Vercel changelog **2026-03 → 2026-08** | Fetches returned a stale 2024 cache; entries were only reachable individually, so something may be unseen | Browse the changelog by hand before finalising |
| Whether the three.js **transpiler handles these 2 specific shaders** | Decides whether WebGPU's shader cost is hours or days | Paste both files into the live transpiler — an hour's work, whenever WebGPU is reconsidered |
| Whether `GTAONode` and **N8AO look meaningfully different** | An art-direction decision disguised as a dependency swap | Only matters if WebGPU is revisited |
| ~~The 2 GLSL shader materials' textures and `colorSpace`~~ | — | **Closed while writing this.** `SizedStarPoints` takes **no texture at all** — its uniforms are `uPointScale`, `uTimeSeconds`, `uGlobalOpacity`, `uSpikeStrength`, all procedural. `NebulaCloudPoints` receives its atlas through a **custom uniform** (`uCloudMap`), and R3F's automatic conversion only ever applied to recognised material texture props (`map`, `emissiveMap`, `envMap`, …), never to arbitrary uniforms. Both are immune by construction |

---

## Sources

All retrieved 2026-08-12.

- Next.js 16 upgrade guide — https://nextjs.org/docs/app/guides/upgrading/version-16 (doc version 16.3.0, updated 2026-08-03)
- Next.js 15 upgrade guide — https://nextjs.org/docs/app/guides/upgrading/version-15 (updated 2026-08-06)
- React 19 upgrade guide — https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- React Three Fiber v9 migration guide — https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- WebGPU browser support — https://caniuse.com/webgpu
- Next.js on Vercel — https://vercel.com/docs/frameworks/full-stack/nextjs (updated 2026-06-26)
- three.js migration guide — https://github.com/mrdoob/three.js/wiki/Migration-Guide
  (read twice; the page is long enough that a single summarising pass
  mis-attributed entries by one release, so entries r174–r185 were re-read
  verbatim and the WebGPU entry-point question was settled from the package
  manifest instead)
- three.js source, compared at both versions —
  `src/renderers/shaders/ShaderChunk/map_fragment.glsl.js` and `src/constants.js`
  at `three@0.171.0` and `three@0.185.1`, via unpkg
- three.js manual, WebGPURenderer — https://threejs.org/manual/en/webgpurenderer.html
  (the unsupported list: `ShaderMaterial`, `RawShaderMaterial`,
  `onBeforeCompile`, `EffectComposer`)
- three.js docs, `RenderPipeline` — https://threejs.org/docs/pages/RenderPipeline.html
  (renamed from `PostProcessing` in r183)
- pmndrs/postprocessing issue #643 — maintainer's WebGPU position, 2024-07-25,
  re-affirmed by closing #690 and #700 as duplicates
- N8AO README — https://github.com/N8python/n8ao ("not yet compatible with WebGPU")
- R3F Canvas API — https://r3f.docs.pmnd.rs/api/canvas (`shadows="soft"` →
  `PCFSoftShadowMap`)
- Vercel: Instant Rollback, Node.js version retirement, Hobby limits, deployment
  promotion — vercel.com/docs
- This repository, measured: `public/` is 68 MB;
  `public/assets/nature/models/experimental/` holds 16.4 MB of `.glb` with no
  reference anywhere in `src/`
- npm registry: `next`, `react`, `react-dom`, `three`, `@react-three/fiber`,
  `@react-three/drei`, `@react-three/postprocessing`, `eslint-config-next`,
  `postcss` — versions, publish dates and `peerDependencies` read directly
- `npm audit --json` in `apps/myunivokai-web` and `apps/myunivokai-admin`
- This repository, read directly: `package.json` ×2, `next.config.mjs`,
  `.github/workflows/ci.yml`, `src/app/**`, `src/features/scene-renderers/**`,
  `src/lib/**`
