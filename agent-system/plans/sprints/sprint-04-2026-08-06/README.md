# Sprint 04 — auth-service, analytics read model, internal admin app

> **Starts:** 2026-08-06
> **Status:** Implemented — `EPIC-S4-AUTH-001` and `EPIC-S4-ANALYTICS-001`
> both shipped. `S4-ANALYTICS-006` landed as configuration only; provisioning
> the Neon database and the Render environment variables remain manual
> operator steps, per `services/analytics-service/README.md`.
> **Last source review:** 2026-08-07

## Sprint goal

Ship the owner's active track in the confirmed priority order —
**auth-service, then the analytics read model, then `apps/myunivokai-admin`** —
so staff can log in, browse records and see charts without the admin app ever
touching a domain service directly. The confirmed cold-start defect
([service-wake-mechanism.md](../../architecture/service-wake-mechanism.md)) is
explicitly out of this sprint; see §Known accepted risk.

Backlog epics:
[EPIC-S4-AUTH-001](../../backlog/engineering-backlog.md#epic-s4-auth-001--staff-identity-and-the-internal-admin-app),
[EPIC-S4-ANALYTICS-001](../../backlog/engineering-backlog.md#epic-s4-analytics-001--a-read-model-for-the-admin-app)

Sprint stories: [user-stories.md](user-stories.md)

Plans this sprint executes:
[auth-and-admin-plan.md](../../services/auth-and-admin-plan.md),
[analytics-service-plan.md](../../services/analytics-service-plan.md)

## Scope

- Freeze auth/admin contracts and analytics contracts (parallel, both phase 0).
- Build `auth-service`: login/refresh/logout, Argon2id, bootstrap admin, the
  code-declared permission sync, seeded `super_admin`/`basic_user`, audit
  events, lockout guards.
- **Start emitting world-change events in universe and nature immediately** —
  the `revision` column, the enriched completed event, and the two new
  `world.changed` subjects — before analytics-service exists, so nothing is
  lost to JetStream's 7-day retention while the consumer is being built.
- Build the gateway's `/api/admin` route group: local token verification with
  the Redis `tokenVersion` cache, default-deny proven by an enumerating router
  test, its own CORS handler and rate limits, `ADMIN_ROUTES_ENABLED`.
- Build `analytics-service`: its own consumer on `MYUNIVOKAI_EVENTS`, inbox
  idempotency, revision-guarded projection upserts, the four
  `queries.analytics.*` subjects.
- Wire `/api/admin/*` reads to analytics-service only — **not** to a
  gateway fan-out across dna/universe/nature.
- Ship the admin app shell (Next.js 15, login, RBAC-aware navigation) and the
  analytics-backed dashboard/worlds/jobs screens.
- Deploy both new services: NATS users, `render.yaml` entries, Neon
  databases, `apps/myunivokai-admin` on its own Vercel project/domain.
- Auth hardening: invite flow, role-management UI, key-rotation drill.

**Supersession, stated explicitly so it is not rebuilt twice:** the original
`auth-and-admin-plan.md` phase 4 (`feat/be/admin-query-subjects` — list/search/
aggregate subjects added to dna, universe and nature) and its phases 5–6
(`feat/fe/admin-records`, `feat/fe/admin-charts`, built against that fan-out)
are **not** built. `analytics-service-plan.md` replaces all three; see its
[§Changes this forces in auth-and-admin-plan.md](../../services/analytics-service-plan.md#changes-this-forces-in-auth-and-admin-planmd).
The record lists and charts ship once, against analytics-service, in
`S4-ANALYTICS-007`.

## Definition of Done

- [ ] A staff account can log in, get a role-scoped session, and reach the
      admin app; disabling the account revokes access within the stated
      Redis-cache window.
- [ ] Every `/api/admin/*` route rejects an unauthenticated request, proven by
      the enumerating router test, and no admin subject is reachable from a
      product route.
- [ ] Variant create/select/publish in universe and nature write a
      revision-stamped outbox row from the day phase 1 lands — verified by the
      repository test that asserts every mutating store method does this.
- [ ] analytics-service's projections match the source databases after a fresh
      consumer run, with duplicate delivery producing no double-counted row.
- [ ] The admin dashboard, worlds table and jobs table render entirely from
      analytics-service; a request trace shows no dna/universe/nature subject
      published on this path.
- [ ] `nickname` is the only personal-data field present in the analytics
      database — checked against the allow list in
      [analytics-service-plan.md §Data boundary](../../services/analytics-service-plan.md#data-boundary--what-crosses-into-analytics-and-what-never-does).
- [ ] Both new services are deployed and pass local + production smoke.

## Known accepted risk — ✅ RESOLVED after the sprint

> **Update 2026-08-08:** this risk no longer stands. The wake mechanism was
> built immediately after the analytics work, on the same branch, once the
> owner confirmed it was next. The gateway now answers a sleeping service with
> `503 SERVICE_WAKING` and starts it, and both frontends wait that out — see
> [service-wake-mechanism.md](../../architecture/service-wake-mechanism.md), whose
> status is now Implemented. The original text is kept below because it is
> what justified shipping the sprint without it.

**analytics-service inherits the same cold-start defect as dna/universe/nature,
unmitigated for this sprint.** Its event consumer never loses data — JetStream
holds up to 7 days regardless of sleep state — but its **query path** fails
identically: a `no-responders` reply, surfaced as `503`, with nothing in the
current system able to wake it back up. This was already recorded as
[analytics-service-plan.md's open decision 4](../../services/analytics-service-plan.md#open-decisions-for-the-owner)
and is carried into this sprint unchanged, per the owner's instruction to fix
it later. Staff may occasionally see a failed admin page load after idle
periods; the fix (proactive/reactive wake, `SERVICE_WAKING` status code) is
fully designed in
[service-wake-mechanism.md](../../architecture/service-wake-mechanism.md) and stays
out of scope here.

## Out of scope

- [service-wake-mechanism.md](../../architecture/service-wake-mechanism.md) —
  deliberately deferred by the owner behind this sprint; see §Known accepted
  risk. **Built directly after the sprint closed**, on the same branch, so this
  exclusion describes the sprint's scope rather than the current state.
- End-user (3D-web visitor) login, world ownership, anonymous claim/migration —
  [`DEFERRED-AUTH-001`](../../backlog/engineering-backlog.md#deferred-auth-001--define-identity-before-authentication)
  stays deferred and unaffected; staff identity never touches ownership.
- Sprint 2 resilience/observability/scale work, and Sprint 3 City.
- Two-factor auth (available in phase 7, not required — owner decision 3).
- Custom permission rows (out of scope — owner decision 6).
- Daily rollups in the analytics schema (deferred — open decision 3).
- Any domain-service admin query/aggregate subject — see §Supersession above.
