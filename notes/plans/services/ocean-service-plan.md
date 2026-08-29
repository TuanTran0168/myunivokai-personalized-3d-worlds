# Ocean service plan — the third family, decided

> **Document status:** **Built 2026-08-15**, in one branch rather than the ten
> in §11 — the owner asked for the whole family at once. Deployed verification
> is outstanding.
> **Decided:** 2026-08-14 by the owner — Ocean proceeds, as its own service,
> named `ocean` rather than `abyss`. Free-tier hosting approved 2026-08-15,
> which closed O3.
> **Last source review:** 2026-08-15.
>
> **Read [§16](#16-what-executing-this-plan-found) before trusting §2 or §7.**
> Four of this document's own claims were wrong, and one of them — a seam
> recorded as needing no change — would have shipped a family the admin app
> could never see.

Ocean is a deterministic deep-sea portrait family: a reef in sunlit water, a
twilight reach, or an abyssal trench, chosen by the visitor's canonical DNA and
drawn from one axis that the other families do not have — **depth**, which
carries real physical numbers rather than an invented table.

It is a peer of Universe and Nature: its own service, its own database, its own
subjects, its own renderer. This plan does not re-argue that.

---

## 1. What is decided, and what this plan does not decide

[ocean-family-research.md](../../evolution/ocean-family-research.md) closed with five open
decisions. Three are answered here because they shape phases; two are named as
still-open with the phase they gate, rather than being quietly assumed.

**Decided — the name is `ocean`, at every machine-readable layer.** `abyss`
names one end of the family's own axis, and a reef config living in a service
called "abyss" would be a permanent mismatch across the database name, the
subjects, the share URLs and the seed streams — none of which can be renamed
cheaply once a share link is public. The evocative names live where the
repository already puts them: `RarityFeature.Label`, landmark kinds, depth-zone
labels and the AI-written `sceneName`. **"The Abyss" is a zone; `ocean` is the
domain.**

**Decided — O4, abyssal creature assets: procedural first, and the rarity
species list ships only when its assets exist.** There is no agent-downloadable
CC0 anglerfish or giant squid. Jellyfish, plankton and bioluminescence are
built procedurally in phase O4 regardless. `ocean-abyss-visitor`'s species
slice, however, is **frozen forever the moment it ships**: selection is
`floor(roll × len)`, so reordering or inserting reassigns the species of every
world already generated. Shipping a species list the renderer cannot draw is
therefore the one mistake in this plan that cannot be undone cheaply. The
catalogue entry lands in **phase O5, after O4 has the models**, not before.

**Decided — O5, audio-visual synesthesia is out of scope of this plan.** It
touches no backend, applies to all four families equally, and would make Ocean's
acceptance depend on work Ocean does not need. It gets its own branch.

**Still open — O2, City's multi-civilisation scope.** Ancient Egypt sits behind
Synty's paywall and CyArk's UNESCO scans are CC BY-NC 4.0, which this
repository's licence policy does not admit. This plan consumes no City asset
budget and does not depend on the answer. It does require the schedule edit in
phase O0: Sprint 3 is City's and must be re-dated in writing rather than left
to drift.

**Still open — O3, the free-tier instance-hour budget.** Ocean is the eighth
`plan: free` service, and blocker B11 in
[platform-evolution-research.md](../../evolution/platform-evolution-research.md) is unanswered
while three already-built services have never been deployed. **This gates phase
O6 only.** Phases O0–O5 produce a service that runs locally and is proven by
tests; none of them requires a Render slot. Treated the same way
[telemetry-service-plan.md](telemetry-service-plan.md) treated its own first
deploy: build it, then answer the budget question before the deploy, not after.

---

## 2. Where Ocean plugs into the platform

Every row below was read in the working tree on 2026-08-14. "None" means the
mechanism already generalises and adding the family changes nothing there —
those rows matter as much as the work rows, because they are where a plan
usually invents work that does not exist.

| Seam | File | Work |
| --- | --- | --- |
| Family enum + 5 subject switches | [`contracts/go/contracts.go`](../../../contracts/go/contracts.go) | `WorldFamilyOcean`, `Valid()`, `ComposeCommandSubject()`, `CompletedEventSubject()`, `FailedEventSubject()`, `WorldChangedEventSubject()` |
| DNA dispatch | [`dna-service/internal/repositories/postgres_store.go:118`](../../../services/dna-service/internal/repositories/postgres_store.go) | **None.** It already calls `job.Family.ComposeCommandSubject()`; the switch above is the whole change. No new AI pipeline — Ocean consumes canonical `ProfileDNA` like every family |
| Gateway handler | [`api-gateway/internal/handlers/nature_handler.go`](../../../services/api-gateway/internal/handlers/nature_handler.go) | Copy to `ocean_handler.go`: 17 lines, a `worldSubjects` literal, nothing else. `WorldHandler` is already parameterised by family |
| Gateway routing | [`api-gateway/internal/handlers/router.go:88-94`](../../../services/api-gateway/internal/handlers/router.go) | One `businessRouter.Route("/api/ocean", …)`. **It must be registered before `/api/{family}`**, which is the catch-all returning `WORLD_FAMILY_NOT_FOUND` |
| Wake mechanism | `api-gateway/internal/wake/platform.go` | `ServiceOcean` + the `Services` slice + `OCEAN_SERVICE_URL`. `ServiceForSubject` resolves by subject prefix, so **no ocean-specific branch**. `internal/config/wake_config_test.go` already enumerates `*_SERVICE_URL` and will fail until the variable exists |
| Analytics read model | `analytics-service/internal/services/analytics_service.go:98` | **None.** `normalizeFamily` gates on `family.Valid()`, so ocean worlds project the moment contracts accept the family |
| Analytics *event emission* | the new service | **Real work, and the failure is silent.** See §6 |
| NATS permissions | — | **None.** Production runs one shared Synadia user with no per-user allow-list; the permission blocks live only in `infra/nats/nats-server.conf`, which is local-development-only and says so on line 1 |
| Local Postgres roles | `infra/postgres/init-databases.sh` + `infra/docker-compose-local.yaml` | One `--set ocean_database/user/password` triple and the matching `OCEAN_DATABASE_*` environment entries |
| Compose | `docker-compose-local.yaml` | One `include:` entry |
| CI | `.github/workflows/ci.yml` | One `ocean-service-checks` job, copied from `nature-service-checks` |
| Deployment | `render.yaml` | One `type: web`, `plan: free` block copied from `myunivokai-nature`, plus `OCEAN_SERVICE_URL` on the gateway block as a `sync: false` entry |
| Frontend | see §7 | Type union, base URL map, **the literal family check at `lib/api.ts:176`**, registry entry, prefetch branch, share route, create-form option set, **and a second preview builder** |

---

## 3. Domain contract

### 3.1 `OceanDNA` — the envelope is already correct

`nature-service/internal/models/dna.go` defines `NatureDNA` as "universe-service's
PersonalityDNA envelope" with one structural difference: the semantic layer is
`Landmarks []DNALandmark` instead of planets. **Ocean needs no new envelope
shape at all** — it needs a new interpretation of the same one.

```go
type OceanDNA struct {
    SchemaVersion   string
    Archetype       string
    SceneName       string
    Quote           string
    ShortNarrative  string
    TraitScores     TraitScores     // creativity, discipline, curiosity, energy, focus
    EnergySignature EnergySignature // primary, secondary, intensity
    Landmarks       []DNALandmark   // the deep-sea places, named from the visitor's own traits
    VisualHints     VisualHints
}
```

`DNALandmark.Type` carries the only new vocabulary: `kelpCathedral`,
`sunkenRelic`, `hydrothermalVent`, `coralGarden`, `abyssalTrench`,
`whaleFall`. The **first** DNA landmark becomes the hero of the portrait,
exactly as the forest's first landmark becomes the heart tree.

The service receives `contracts.ComposeWorldData` — `ProfileDNA` plus
`VisualIntent{Mood, FavoriteColors, PreferredWorldStyle}` — and maps it down,
the same direction nature-service already maps.

### 3.2 `OceanSceneConfig` — section for section against forest

`oceanSchemaVersion = "1.0"`, `oceanSceneType = "ocean"`. Stored configs stay
small (~3–4 KB): semantics and hero placements only; mass scatter is re-derived
on the frontend from placement seeds, the pattern both existing families use.

| Section | Contents |
| --- | --- |
| `depth` | `metres`, `zone` (`sunlitShallows` · `twilightReach` · `abyss`), `blendTowardZone`, `blendAmount` — the same "giao mùa" blend the forest's `season` uses |
| `water` | `fogColor`, `fogDensity`, `visibilityMetres`, `tintStrength` — **all derived from `depth` by §4, then stored** |
| `lighting` | `surfaceLightColor`, `surfaceElevationRadians`, `godRayStrength`, `causticStrength`, `ambientColor`, `exposure`. **No `hdriKey`** — there is no sky |
| `seafloor` | `placementSeed`, `basinRadius`, `ridgeAmplitude`, `ridgeFrequency`, `rockCount`, `sedimentTuftCountDesktop/Mobile` |
| `current` | `kind` (`still` · `drift` · `surge`), `intensity`, `directionRadians`, `gustFrequency`, `marineSnowCountDesktop/Mobile` |
| `flora` | `placementSeed`, `countDesktop/Mobile`, `speciesMix` (kelp · seagrass · coral · anemone), `scaleMin/Max`, `swayStrength`, `depthTintStrength` |
| `fauna.schools` | per school: `pathSeed`, `count`, `species`, `depthBandMin/Max`, `swimSpeed`, `cohesion`, `separation` |
| `fauna.drifters` | jellyfish and siphonophores: `count`, `pulseRate`, `emissiveColor` |
| `fauna.giants` | 0–1 entries: `species`, `passSeed`, `approachDistance`, `passDurationSeconds` |
| `bioluminescence` | `planktonCount`, `bloomIntensity`, `emissiveColors`, `flickerSeed` |
| `landmarks` | `key`, `name`, `kind`, `meaning`, `energy`, `position`, `scale` — identical mechanism to the forest's |
| `camera` · `postFX` · `hud` · `assets` | unchanged from the forest contract, minus `hdriKey` |

Palette anchors stay the repository defaults (`#8B5CF6`, `#06B6D4`, accent
`#FACC15`) so a visitor's favourite colours read the same across all three
portraits — the rule `forest_config_builder.go` already states.

---

## 4. The depth curve — the only genuinely new maths

This is the piece nothing in the repository has an equivalent of, so it gets a
specification rather than a description.

**Anchors, from measured oceanography** (sources in the research document):

| Depth | Fraction of surface light | Channel that has died |
| --- | --- | --- |
| 0 m | 1.00 | — |
| 1 m | 0.45 | — |
| 10 m | 0.16 | red |
| 40 m | 0.05 | orange |
| 100 m | 0.01 | yellow |
| 1000 m | 0.00 | all |

**A single exponential does not fit these points and must not be used.**
Anchoring Beer–Lambert on the 1 m value gives `k ≈ 0.80/m`, which predicts
0.03 % at 10 m against the measured 16 %. The attenuation coefficient itself
falls with depth, because the strongly absorbed wavelengths are gone by then.
Implement as **monotone piecewise interpolation in log space between the
anchors**: `k ≈ 0.115/m` from 1→10 m, `k ≈ 0.031/m` from 10→100 m.

Per-channel death depths (red 10 m, orange 40 m, yellow 100 m) are applied as a
smoothstep to zero on each channel, which is what makes a red coral read
brown-grey at depth without anyone hand-picking a brown.

**Two rules that keep this safe:**

1. **The curve runs in the backend builder, and only its results are stored.**
   `water.fogColor`, `fogDensity`, `lighting.godRayStrength` and
   `causticStrength` are numbers in the saved config. Re-tuning the curve later
   changes new worlds and leaves existing ones exactly as they were rendered —
   the same guarantee the golden fixtures give every other builder value.
2. **`godRayStrength` and `causticStrength` reach zero on their own** as depth
   crosses the sunlight floor. No branch anywhere says "if abyss then disable
   caustics"; the function does it, which is why one renderer covers a sunlit
   reef and an abyssal trench without a mode flag.

**Required tests** (`internal/services/depth_curve_test.go`):

- each anchor reproduces its measured value within tolerance;
- light is strictly non-increasing across 0→2000 m sampled at 1 m;
- red is zero below 10 m, orange below 40 m, yellow below 100 m;
- `godRayStrength` and `causticStrength` are exactly `0` below 1000 m;
- a depth outside `[0, 11000]` clamps rather than extrapolating.

---

## 5. Determinism

`internal/seed/prng.go` is copied byte-identically from nature-service — FNV-64a
into `math/rand` — because, as its own comment says, the determinism story stays
one story across the fleet.

Seed stream labels are prefixed `-ocean-`, following the discipline
`forest_config_builder.go` wrote down explicitly (its `-forest-` prefix exists
"so future families inside nature-service can never collide"):

```
-ocean-depth      -ocean-lighting   -ocean-seafloor   -ocean-current
-ocean-flora      -ocean-fauna      -ocean-biolum     -ocean-landmarks
```

Frontend scatter streams, stored in the config and never drawn from by the
backend: `-ocean-seafloor-scatter`, `-ocean-flora-placement`,
`%s-ocean-school-%d`, `%s-ocean-giant-%d`.

**Every stream draws on every build even when a gate zeroes the feature.** This
is the rule that lets a later feature be added without shifting an existing
world's draws, and it is the reason the forest's builder survives schema bumps.

**Golden fixtures** mirror `forest_golden_test.go`: four cases across the four
mood values, byte-compared against committed JSON, regenerated only
deliberately with `UPDATE_GOLDEN=1`. A byte-level change to what the builder
emits for an existing seed is a **breaking** change: bump `oceanSchemaVersion`
and keep a reader for the old version.

---

## 6. The event the admin app needs, and why it fails silently

From the read-model amendment in [city-service-plan.md](city-service-plan.md),
which applies unchanged and is the easiest thing in this plan to forget,
**because nothing fails when you do** — ocean worlds simply never appear in the
admin app. From the first migration:

- `worlds.revision INTEGER NOT NULL DEFAULT 1`;
- bump the revision and write a `world.changed` outbox row **inside the same
  transaction** as every mutation — variant create, variant select, publish;
- attach the world's first `contracts.WorldSnapshot` to the `completed` event
  rather than publishing a separate one;
- copy `internal/repositories/world_snapshot.go` **and
  `world_snapshot_test.go`** from universe-service. That test asserts every
  mutating store method leaves an event behind, and it is the only thing that
  catches the omission.

---

## 7. The frontend has a second builder, and the City plan never mentions it

The create form renders a **live WebGL preview before anything is generated**,
built by a client-side mirror of the backend builder:
`lib/scene.ts` → `buildPreviewSceneConfig` for universe, `lib/forestScene.ts` →
`buildPreviewForestSceneConfig` for forest, selected at
[`app/page.tsx:173`](../../../apps/myunivokai-web/src/app/page.tsx).

Ocean therefore needs **`lib/oceanScene.ts` with `buildPreviewOceanSceneConfig`
and its own test file**, and that file is a *second implementation of the depth
curve*. It is the same drift risk the rarity catalogue has between Go and
TypeScript, and it gets the same treatment: the preview builder is asserted
against the **same committed golden fixture** the Go builder is, so the two
cannot diverge without a red test.

The full frontend inventory:

| File | Change |
| --- | --- |
| `lib/types.ts` | `WorldFamily` union gains `"ocean"`; the ocean config sections |
| `lib/api.ts` | `API_BASE_URLS_BY_FAMILY` entry — **and the literal `=== "universe" \|\| === "nature"` check at line 176**, which a new family falls silently through. It fails no build |
| `lib/scene.ts` | `isOceanScene`, plus an ocean branch in `pointsOfInterestFromScene` so landmarks become POIs and HUD/hover/camera stay family-agnostic |
| `lib/oceanScene.ts` + test | The preview builder, pinned to the Go golden fixture |
| `features/scene-renderers/registry.ts` | One lazy loader, one `SCENE_TYPE_RENDERER_REGISTRY` entry, one `prefetchSceneRendererForFamily` branch |
| `features/scene-renderers/ocean/` | The renderer — the bulk of the work |
| `app/ocean/share/worlds/[shareSlug]/page.tsx` | Mirrors the two share routes; `params` is a Promise on Next 15 |
| `app/page.tsx` | `familyOptions` gains Ocean; a new `oceanMoodOptions` set (same four backend mood *values*, ocean-flavoured labels — the existing rule) |

`CameraRig` and `PlanetPositionTracker` need **no change**: a renderer that
writes positions into the shared Map gets click-to-focus for free.

---

## 8. Assets and audio

Pipeline unchanged: [poly.pizza](https://poly.pizza), self-hosted under
`public/assets/ocean/`, Draco via `@gltf-transform/cli`, `ATTRIBUTION.md`
updated for every file including CC0 ones. Sketchfab stays owner-manual — its
download endpoints return 401 without an OAuth session even for CC-BY models.

| Need | Source | Licence |
| --- | --- | --- |
| Fish, dolphin, shark, **whale, manta** — 7 models, each animated | [Animated Fish Bundle, Quaternius](https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g) | **CC0** |
| Kelp, seagrass, coral, anemone | [seaweed](https://poly.pizza/search/seaweed) · [coral](https://poly.pizza/search/coral) | mixed — filter `License=1` |
| Jellyfish, plankton, bioluminescence | **procedural** | — |
| Whale song, hydrophone bed | [NOAA PMEL](https://www.pmel.noaa.gov/acoustics/multimedia.html) · [NPS humpback](https://archive.org/details/HumpbackWhalesSongsSoundsVocalizations) | **public domain** |

Budget target: **≤ 16 GLB, ≤ 3 MB compressed, 0 HDRI** — against the forest's
33 GLB + 3 HDRI ≈ 6.5 MB. Ocean needs no sky dome and no environment map.

The audio layer reads exactly one input, `SceneConfig`, so Ocean adds a score
and a sample category and changes no mechanism. Do not add a fifth family to
the arranger without reading
[ambient-audio-mechanism.md](../../knowledge/frontend/ambient-audio-mechanism.md) first: three
earlier versions of that system shipped verified-and-wrong.

---

## 9. Rarity catalogue — phase O5, not before

Mirrored in `contracts/go/contracts_rarity.go` **and** `lib/rarity.ts`, pinned
by `contracts/fixtures/rarity/rare-feature-rolls.v1.json`. All three or none.

| Key | Label | p | Species (ordered — frozen on ship) |
| --- | --- | --- | --- |
| `ocean-bioluminescent-bloom` | Bioluminescent Bloom | 0.35 | — |
| `ocean-whale-passage` | Whale Passage | 0.12 | humpback · blue whale · manta parade |
| `ocean-sunken-relic` | Sunken Relic | 0.20 | — |
| `ocean-abyss-visitor` | Abyssal Visitor | 0.05 | **decided in O4 by what can actually be rendered** |

Two rules from that file, both load-bearing: species order is a contract, and
each feature owns its own `seedSuffix` so re-tuning one never shifts another.

---

## 10. Phases

### O0 — Contracts and schedule

- `WorldFamilyOcean` and the five subject switches; `myunivokai.commands.ocean.compose.v1`, `myunivokai.queries.ocean.*`, `myunivokai.events.ocean.*`.
- `contracts/scenes/ocean-scene-config.schema.json` + a fixture validated in CI beside the forest one.
- **Re-date Sprint 3 in `notes/sprints/` in writing**, and add the Ocean epic to `notes/plans/backlog/engineering-backlog.md`.

*Exit:* schema validates in CI; the frontend has a discriminated type for `ocean`; the schedule change is recorded, not implied.

### O1 — `ocean-service` foundation

- Module `github.com/myunivokai/myunivokai/services/ocean-service`, Go 1.25.7, layout copied from nature-service: `cmd/service`, `cmd/migrate`, `internal/{config,db,handlers,messaging,models,repositories,seed,services}`.
- `config.Load()` following the repo pattern — godotenv, `get`/`getInt`/`getDuration`, a named default constant per value, `PUBLIC_WEB_URL` defaulting to `http://localhost:41300/ocean`.
- goose migration `000001_init.sql`: `worlds` (**with `revision`**), `world_variants`, `world_shares`, `inbox_messages`, `outbox_messages`.
- `Store` interface, `MemoryStore`, `PostgresStore`, and `world_snapshot.go` + `world_snapshot_test.go` copied from universe-service.
- `messaging/runtime.go`: JetStream pull subscription on the compose subject, six queue-subscribed query subjects, the outbox publisher loop, graceful shutdown.

*Exit:* `go vet ./...` and `go test ./...` green; duplicate delivery of one compose command produces exactly one world.

### O2 — The deterministic builder

- `ocean_scene_profile.go` (the tuning tables) + `ocean_config_builder.go` (`Build(BuildOceanConfigInput{DNA, Seed, VariantNo, Input})`), split the same way the forest's pair is.
- The depth curve and its test suite from §4.
- Golden fixtures across the four moods.

*Exit:* golden fixtures stable; the depth tests pass; no value in the output is drawn outside a named `-ocean-` stream.

### O3 — Gateway, wake, read model

- `ocean_handler.go`, the `/api/ocean` route **before** the `/api/{family}` catch-all, `ServiceOcean` + `OCEAN_SERVICE_URL`.
- Local Compose: service entry, `include:` line, `infra/postgres/init-databases.sh` triple, `OCEAN_DATABASE_*` in `.env.example`.
- Verify a locally generated ocean world reaches `myunivokai_analytics` — the check that catches a missing outbox row.

*Exit:* the whole lifecycle runs locally through the gateway; the world appears in the admin app.

### O4 — Assets and the renderer

- Asset catalogue + `ATTRIBUTION.md`; Draco pass; `normalizationForObject` reused.
- `features/scene-renderers/ocean/`: seafloor, flora, schools, drifters, giants, bioluminescence, god rays, caustics, surface-from-below.
- **Decide `ocean-abyss-visitor`'s species here**, from what can actually be drawn.
- Screenshot review across the three depth zones before wiring the product flow.

*Exit:* owner-approved stills at all three zones; the budget in §8 met or the overage explained.

### O5 — Product flow, audio, rarity

- Registry entry, prefetch branch, create-form option and moods, preview builder pinned to the Go fixture, share route.
- The ocean score and the whale-call sample category.
- The four rarity entries, in Go and TypeScript, against the shared fixture.

*Exit:* create → view → regenerate → select → publish → share all work through the gateway; the preview matches the generated world.

### O6 — Deploy and verification — **gated on O3's budget answer**

- `render.yaml` block, `ocean-service-checks` CI job, Neon `myunivokai_ocean`, `OCEAN_SERVICE_URL` filled on the gateway.
- Deployed smoke across the full lifecycle; commit SHA, timestamp and pass/fail recorded without secrets.

*Exit:* Ocean is `Verified`, not merely `Implemented`.

---

## 11. Branch sequence

One concern per branch, each cut from the latest `staging`:

1. `feat/repo/ocean-executable-contracts`
2. `feat/be/ocean-service-foundation`
3. `feat/be/ocean-config-builder`
4. `feat/be/ocean-gateway-routing`
5. `feat/repo/ocean-local-stack`
6. `feat/fe/ocean-scene`
7. `feat/fe/ocean-product-flow`
8. `feat/fe/ocean-ambient-audio`
9. `feat/repo/ocean-rarity-catalogue`
10. `feat/repo/ocean-production-verification`

Do not branch an implementation branch from the docs branch; merge the docs PR
into `staging` first.

---

## 12. Definition of high-fidelity feature complete

Borrowed from [city-service-plan.md §2](city-service-plan.md) and specialised:

- one seed always yields the same layout, species, lighting and motion;
- the three depth zones are visibly different worlds, and the difference comes
  from the curve rather than from three hand-authored presets;
- a red-tinted object at 30 m reads brown-grey without anyone authoring brown;
- bioluminescence is legible in the abyss **without** the Bloom pass carrying it
  alone — the scene must still read with post-processing disabled;
- schools move as groups, not as individuals on parallel paths;
- one giant passing at fog distance is a moment, not a prop;
- the whole lifecycle works through the gateway;
- saved worlds keep rendering after a later deploy;
- owner-approved screenshots exist as the regression baseline.

---

## 13. Out of scope

- Audio-visual synesthesia (§1) — its own branch, all families.
- City work of any kind, including its unresolved asset-budget question.
- Swimming/diving controls, a first-person camera, or any character controller.
- Ocean-specific AI prompts. Ocean consumes canonical DNA.
- Mobile/weak-device tiers before the desktop baseline is approved.
- A fifth family inside `ocean-service`.

## 14. Risks accepted

**The retention trap, inherited.** `MYUNIVOKAI_EVENTS` retains 7 days. If
analytics-service is asleep and unwoken while ocean worlds are generated, those
projections are lost silently — the same trade already accepted for every
family, mitigated by `WorldHandler.wakeReadModel`.

**Eight free services.** Recorded again because it is the most likely thing to
go wrong at O6 rather than during development.

**The preview builder is a second implementation.** Pinned by a shared fixture,
but it is still two codebases computing one curve.

## 15. What must not happen

- Do not name any machine-readable identifier `abyss`.
- Do not ship `ocean-abyss-visitor`'s species list before O4 proves each one can
  be drawn. The order is frozen on first ship.
- Do not render caustics or god rays below the sunlight floor.
- Do not let a stream stop drawing when a feature is gated off.
- Do not ship without `worlds.revision` and the `world.changed` outbox row.
  Nothing fails; the worlds simply never reach the admin app.
- Do not register `/api/ocean` after the `/api/{family}` catch-all.
- Do not add a field to `contracts.WorldSnapshot` without adding the matching
  line to the data boundary in
  [analytics-service-plan.md](analytics-service-plan.md).
- Do not add NATS permission work to any estimate for this plan.

---

## 16. What executing this plan found

The plan was written from the working tree and was still wrong in four places.
They are recorded here rather than quietly fixed, because three of the four
would have failed silently, and the pattern behind them is worth more than the
individual corrections.

### 16.1 "Analytics: None" was wrong, and it was the dangerous one

§2 recorded the analytics read model as needing **no change**, on the grounds
that `normalizeFamily` gates on `family.Valid()`. That much is true. What the
row missed is that `BuildProjection` does not dispatch on the family field at
all — it switches on **subject literals**, in three separate arms:

```go
case contracts.UniverseCompletedEventSubject, contracts.NatureCompletedEventSubject:
case contracts.UniverseFailedEventSubject, contracts.NatureFailedEventSubject:
case contracts.UniverseWorldChangedEventSubject, contracts.NatureWorldChangedEventSubject:
```

An ocean event reaching that switch falls to `default`, resolves to
`ErrUnknownSubject`, and is **skipped rather than retried** — which is correct
behaviour for a subject from a service analytics does not know about, and
exactly why nothing would have gone red. Ocean worlds would simply never have
appeared in the admin app, which is the same failure §6 warns about for the
outbox, arriving from the other end.

Two more of the same shape turned up beside it:

- `analytics-service/internal/repositories/postgres_queries.go` had a
  hard-coded `[]WorldFamily{Universe, Nature}` ordering the overview's family
  cards.
- dna-service's `familyForResultSubject` **and** its JetStream
  `ConsumerFilterSubjects` list both enumerate the family result subjects. The
  plan's "None" was right about outbound dispatch — `job.Family.ComposeCommandSubject()`
  really does generalise — and wrong about inbound result consumption, which is
  a different code path in a different file.

**The lesson, for the next family:** `family.Valid()` generalising is not the
same as the *dispatch* generalising. Grep for the subject constants, not for the
family type.

### 16.2 `DNALandmark.Type` does not carry the landmark vocabulary

§3.1 said `DNALandmark.Type` carries `kelpCathedral`, `sunkenRelic` and the
rest. In the working tree that field is the human provenance label — nature-service
sets it to `"Interest Landmark"` or `"Trait Landmark"` from `facet.Kind` — and
the scene KIND is a separate seeded draw made in the builder, deduped against
the kinds already used.

Built to mirror the forest exactly: `Type` stays the provenance label, and the
ocean vocabulary lives in the builder's `nonHeroLandmarkKinds`, with
`kelpCathedral` as the fixed hero the way `heartTree` is. A landmark's meaning
therefore never depends on which shape the lottery gave it.

### 16.3 The preview cannot be pinned byte-for-byte, and did not need to be

§7 required the preview builder to be "asserted against the **same** committed
golden fixture the Go builder is". Taken literally that is not achievable
without porting Go's `math/rand` — a lagged-Fibonacci generator over a
607-element table — into TypeScript, because the frontend PRNG is a 32-bit
xorshift. The forest preview already accepts this and says so: its output is
*plausible*, not byte-equal.

What matters is narrower than what the plan asked for. The seeded halves of the
two builders are duplicated **tables**, which drift loudly (a missing species
shows up immediately). The depth curve is duplicated **logic**, which drifts
silently — and it takes no PRNG at all, so it can be pinned exactly.

`oceanDepthCurve.test.ts` therefore reads the Go builder's four golden fixtures
directly out of `services/ocean-service/.../testdata/` and asserts that the
TypeScript curve reproduces every stored water and lighting value, hex colours
included. It passes, which also settles a real question about floating point:
Go's and V8's `exp`/`log` agree to within the two decimals both sides round to.

### 16.4 The first zone boundaries made two of the three zones identical

The plan used the textbook oceanographic boundaries — epipelagic to 200 m,
mesopelagic to 1000 m — with a twilight band of 220–900 m. Built that way, the
`focused` golden landed at 750 m and came out with **byte-identical water and
lighting** to the `reflective` golden at 2431 m: `#030914` fog, 12 m visibility,
zero god rays, both. Two of the three zones were the same world.

The physics was right and the boundaries were wrong. Both are now constants of
the depth curve itself rather than round numbers:

- the sunlit shallows end where **orange dies**, at 40 m;
- the twilight reach ends at the **sunlight floor**, 1000 m — which is also
  where god rays and caustics reach zero, so "the abyss has no caustics" is a
  consequence rather than a rule.

The bands moved with them: 3–28 m for the reef (where reef-building coral
actually lives), 45–170 m for the twilight, 1050–3800 m for the abyss. The
goldens now read `#127586` / `#024667` / `#030914` across the three, and a test
fails if they ever collapse back into one sea.

### 16.5 The literal family check had two siblings

§2 named `lib/api.ts:176` as "the one literal family check that fails no build".
There were three:

| Where | What it silently did |
| --- | --- |
| `lib/api.ts` | Discarded a resumed generation for the new family on reload |
| `lib/savedWorlds.ts` | Dropped every ocean world out of the visitor's gallery |
| `lib/ambientSoundscape.ts` | Arranged the sea as a solar system — an `isForest: **boolean**` has two answers, and the third family arrived as "not forest" |

All three are now derived from a `Record<WorldFamily, …>` or a three-valued
union, so the compiler refuses the next family rather than defaulting it.

### 16.6 What the plan got right

Worth recording as well, because it is what the seam inventory was for: the
gateway's `WorldHandler` needed a 17-line handler and one route; `wake.ServiceForSubject`
needed no ocean branch; `CameraRig` and `PlanetPositionTracker` needed nothing
at all; and NATS production permissions cost exactly what the plan said they
would, which is nothing.

### 16.7 Decisions this closed

- **O3 — free-tier budget.** Approved by the owner on 2026-08-15. The
  `render.yaml` block is `plan: free`, and Ocean is the eighth such service.
- **O4 — `ocean-abyss-visitor`'s species.** Settled as anglerfish, giant squid,
  gulper eel, in that frozen order, against what the procedural `ocean-1`
  catalogue actually builds. That catalogue resolves every model key to browser
  geometry rather than a downloaded GLB, which is what made the decision
  possible at all: no licence, no download, and no species that cannot be drawn.
- **O2 — City's multi-civilisation scope.** Still open, and still nothing this
  family depends on. City moved to
  [2026-09-09](../sprints/sprint-03-2026-09-09/README.md).
