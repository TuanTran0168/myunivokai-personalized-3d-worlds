# Myunivokai Web

The Next.js client for Myunivokai. It knows one public origin through
`NEXT_PUBLIC_GATEWAY_BASE_URL` (local default `http://localhost:41800`) and never
receives AI, NATS, Redis, database, or domain-service credentials.

Generation preserves the existing UI flow while using the asynchronous API:
the client receives `202 + jobId`, polls queued/processing status with bounded
backoff and a two-minute deadline, stores the pending job in session storage,
and resumes polling after a refresh. It loads and navigates to the world only
after the job is completed.

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Universe and Forest rendering remain selected by the scene registry and family
route helpers; the migration does not move rendering or provider calls into the
browser.

## Seeing the scene

```powershell
npm run shoot        # writes e2e/shots/, then compare against e2e/reference/
```

Deliberately absent from the block above. None of those five commands can see
the canvas: a scene that draws the wrong colour, the wrong geometry or nothing
at all passes every one of them, and the file most able to do that —
`features/scene-renderers/forest/forestModels.ts` — recolours foliage by
string-replacing into a three.js built-in shader, which returns the original
string and throws nothing when it stops matching.

`npm run shoot` photographs both families at two viewports against pinned
fixtures under SwiftShader, so the images depend on the code rather than on the
machine. They are compared **by eye, for content**, against the committed sets
in `e2e/reference/` — never by pixel assertion, and never in CI. The full
reasoning, and what each shot is for, is in
[e2e/reference/README.md](e2e/reference/README.md).

Run it either side of any dependency change that could reach the renderer. It
is how the Next 15 / React 19 / R3F v9 upgrade was verified, and it caught a
runtime break that build, lint, typecheck and 259 unit tests all passed.

## Stack

Next.js 15 (App Router) · React 19 · React Three Fiber v9 · three 0.171 ·
Tailwind 3 · TypeScript 5.

Route params are Promises: the share pages `await` them, and
`worlds/[worldId]` reads them with React's `use` because it is a client
component. `three` and ESLint are deliberately held back — each is its own
separately revertible change. See
[notes/vision/frontend-modernization-research.md](../../notes/vision/frontend-modernization-research.md).
