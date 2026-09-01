# Ocean Service

Ocean Service is the private NATS bounded context for deterministic Ocean
worlds. It does not expose HTTP and does not call an AI provider.

It consumes `myunivokai.commands.ocean.compose.v1`, snapshots canonical
ProfileDNA, builds an `OceanSceneConfig`, persists inbox/world/variant and
completion outbox atomically, and answers versioned Core NATS queries for
get/list/variant/select/publish/share.

`internal/handlers/NATSHandler` owns compose and world-lifecycle transport
handling; `internal/messaging` owns NATS connection, subscription, retry/ack,
and outbox lifecycle. Everything above is the shape nature-service already had
— read that service first if this one is new to you, then read the section
below, which is the only part that is genuinely different.

## The depth curve is the whole family

`internal/services/depth_curve.go` is the one piece of this repository that has
no equivalent anywhere else in it, and it is specified rather than described.

A world sits at a depth. Everything about how it looks — the colour of the
water, how far you can see, whether god rays reach you, whether caustics play
on the floor — is **derived from that depth** by measured light attenuation:

| Depth | Fraction of surface light | Band that has died |
| --- | --- | --- |
| 0 m | 1.00 | — |
| 1 m | 0.45 | — |
| 10 m | 0.16 | red |
| 40 m | 0.05 | orange |
| 100 m | 0.01 | yellow |
| 1000 m | 0.00 | all |

**A single exponential does not fit these points, and the file says so with a
test.** Anchoring Beer–Lambert on the 1 m measurement gives `k = 0.80/m`, which
predicts 0.03% of surface light at 10 m against a measured 16% — wrong by three
orders of magnitude, and completely plausible on screen. The attenuation
coefficient itself falls with depth, because the strongly absorbed wavelengths
are already gone by then. The curve is therefore monotone piecewise-exponential
between the anchors above.

Three consequences are worth knowing before changing any of it:

- **The curve runs here, and only its RESULTS are stored.** `water.fogColor`,
  `fogDensity`, `lighting.godRayStrength` and `causticStrength` are plain
  numbers in the saved config. Re-tuning this file changes new worlds and leaves
  every existing one exactly as it was rendered. Do not move any of this into
  the renderer.
- **God rays and caustics reach zero on their own.** No branch anywhere — not
  here, not in the frontend — says "if abyss then disable caustics". They are
  the light fraction times a gain, and the light fraction is exactly zero at and
  below the sunlight floor. That is what lets one renderer cover a sunlit reef
  and an abyssal trench without a mode flag.
- **The zone boundaries are constants of the curve, not round numbers.** The
  sunlit shallows end where orange dies (40 m); the twilight reach ends at the
  sunlight floor (1000 m). An earlier draft used the textbook 200 m boundary and
  produced a 750 m "twilight" world byte-identical in water and lighting to a
  2430 m abyssal one — see §16.4 of
  [agent-system/plans/services/ocean-service-plan.md](../../agent-system/plans/services/ocean-service-plan.md).

The curve is implemented **twice**: here, and in
`apps/myunivokai-web/src/lib/oceanDepthCurve.ts`, which the create form's live
preview needs. There is no compiler between them, so
`oceanDepthCurve.test.ts` reads this service's own golden fixtures out of
`internal/services/testdata/` and asserts the TypeScript reproduces every stored
value, hex colours included. If you change an anchor, a gain or a colour
constant here, that test is what will notice.

## Determinism

`internal/seed/prng.go` is byte-identical to universe-service's and
nature-service's: FNV-64a into `math/rand`. The determinism story stays one
story across the fleet.

Every section draws from its own seed stream, prefixed `-ocean-` so it can never
collide with a forest or universe one, in a fixed draw order — and **every
stream draws on every build even when a gate zeroes the feature**. That is what
lets a feature be added later without shifting an existing world's draws.

The four golden fixtures in `internal/services/testdata/` are the compatibility
contract in executable form, and they deliberately span all three depth zones
and both the with-a-giant and without-a-giant cases; a test fails if they ever
collapse into one. A byte-level change to what the builder emits for an existing
seed is a **breaking** change: bump `oceanSchemaVersion`, keep a reader for the
old version, and regenerate deliberately with
`UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures`.

## World-change events

Identical to nature-service, and identically easy to forget — **because nothing
fails when you do.** Every mutation bumps `worlds.revision` and writes a
`world.changed` snapshot to the outbox inside the same transaction; creation
carries its first snapshot on the `completed` event instead, so
`analytics-service` has one projection function rather than two.

`internal/repositories/world_snapshot.go` is the single place that decides what
leaves this database. It is an **allow list**: the quote, the DNA snapshot,
variant scene configs and share slugs are absent on purpose and must stay
absent. `world_snapshot_test.go` asserts that every mutating store method leaves
an event behind, and it is the only thing that catches the omission.

Unlike the other two families, `revision` ships in this service's **first**
migration rather than arriving later, because analytics-service already existed
when this one was written.

## Assets

There are none. The `ocean-1` catalogue resolves every model key to procedural
geometry built in the browser
(`apps/myunivokai-web/src/features/scene-renderers/ocean/oceanModels.ts`), and
the family uses no HDRI at all — there is no sky a thousand metres down. That
was a decision, not a shortcut: no agent-downloadable CC0 anglerfish or giant
squid exists, and the rare-feature species order is frozen the moment the first
world ships, so a species the renderer cannot draw is the one mistake here that
cannot be undone cheaply.

Swapping a key to a self-hosted GLB later changes no stored config and
re-renders every world that already exists.

## Local development

```bash
cd services/ocean-service
go vet ./... && go test ./... && go build ./...
```

The full stack, including this service's database and NATS user, comes up with
`make local-up` from the repository root. Standalone Compose lives in
`docker-compose-local.yaml` beside this file.
