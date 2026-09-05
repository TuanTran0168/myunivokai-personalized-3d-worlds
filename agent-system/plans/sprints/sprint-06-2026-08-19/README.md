# Sprint 06 — Ocean, the third family

> **Starts:** 2026-08-19
> **Status:** Implemented. **Deployed and healthy, but NOT `Verified`** —
> and the distinction is the point, so it is spelled out rather than left as
> a phrase.
>
> What IS evidenced, from Render's log API on 2026-09-05:
> `ocean database migrations complete`, `ocean health server listening` and
> `ocean service ready` at 2026-09-04T17:41:33-36, on commit `2a7cfde4`. The
> service starts, migrates its own database and subscribes.
>
> What is NOT evidenced, and is the whole of this sprint's acceptance:
> **no ocean world has been observed composed end to end in production.**
> A service that boots is not a family that works — the depth curve, the
> stored scene config and the renderer are exactly what a startup log cannot
> speak to. Creating one to find out writes production data, so it is an
> owner's call rather than a check to run quietly.
>
> One line worth not mistaking for a defect: an
> `error: nats: invalid subscription` on `fetch ocean composition` at
> 17:56:36 — the same second the free-tier instance was shutting down, and
> the consumer losing its subscription during teardown is that shutdown, not
> a failed composition.
> **Last source review:** 2026-09-05

## Sprint goal

Ship Ocean as a third independent bounded context — its own service, its own
database, its own subjects, its own renderer — built from one axis the other two
families do not have: **depth**, carrying measured physical numbers rather than
an invented table.

Design: [ocean-service-plan.md](../../services/ocean-service-plan.md)
Evidence and argument: [ocean-family-research.md](../../../evolution/ocean-family-research.md)
Backlog epic: [EPIC-S6-OCEAN-001](../../backlog/engineering-backlog.md#epic-s6-ocean-001--add-ocean-as-the-third-family)

## Why this sprint exists, and why it took Sprint 03's slot

The owner brought Ocean forward on 2026-08-15 and moved City to
[2026-09-09](../sprint-03-2026-09-09/README.md). The two families are disjoint —
different services, databases and asset budgets — so the move costs City nothing
but calendar time, and Ocean does not consume any of City's unresolved asset
budget question.

Ocean was also the cheaper of the two to ship honestly. City's multi-civilisation
ambition runs into a licence wall (CyArk's UNESCO scans are CC BY-NC 4.0, which
this repository's policy does not admit; Ancient Egypt sits behind Synty's
paywall). Ocean needs no licensed asset at all: the `ocean-1` catalogue resolves
every model key to procedural geometry built in the browser.

## Scope

- `WorldFamilyOcean` and its command/query/event subjects in `contracts/go`,
  plus `contracts/scenes/ocean-scene-config.schema.json` and a world-changed
  fixture, all validated in CI.
- `services/ocean-service`: Go 1.25.7, the layout nature-service uses, goose
  migrations with `worlds.revision` from the first migration, inbox/outbox,
  `world_snapshot.go` and its drift guard.
- The depth curve: monotone piecewise-exponential between measured light
  anchors, its results **stored** rather than recomputed, with the five tests
  the plan specified plus three more.
- The deterministic builder, `-ocean-` prefixed seed streams, four golden
  fixtures covering all three depth zones.
- Gateway handler and the `/api/ocean` route **above** the `/api/{family}`
  catch-all; `ServiceOcean` and `OCEAN_SERVICE_URL` in the wake mechanism.
- Frontend: the family type, the preview builder pinned to the Go goldens, the
  procedural renderer, the share route, the create-form option set, the ocean
  arrangement in the ambient audio layer, and the four rarity entries.
- Local Compose, `init-databases.sh`, `.env.example`, an `ocean-service-checks`
  CI job, and a `plan: free` Render block.

## Out of scope

- Audio-visual synesthesia (its own branch, all four families).
- Any City work, including its unresolved asset-budget question.
- Swimming or diving controls, or any character controller.
- Ocean-specific AI prompts. This family consumes canonical DNA like the others.
- Mobile tiers before the desktop baseline is owner-approved.

## Exit

Ocean is **Implemented** when the full local lifecycle runs through the gateway
and every automated check passes. It becomes **Verified** only when a deployed
smoke run across create → view → regenerate → select → publish → share is
recorded with its commit SHA and timestamp, and an ocean world is confirmed to
have reached `myunivokai_analytics`.
