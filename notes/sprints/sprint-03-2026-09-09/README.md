# Sprint 03 — City vertical slice

> **Starts:** 2026-09-09 (moved from 2026-08-19 on 2026-08-15, when the owner brought the Ocean family forward — see Sprint 06)
> **Status:** Planned; starts only after Sprint 2 gates
> **Last source review:** 2026-07-22

## Sprint goal

Add City as a new independent bounded context on the proven platform and ship a
high-fidelity desktop vertical slice from canonical DNA through public share.

Backlog epic: [EPIC-S3-CITY-001](../../user-stories/engineering-backlog.md#epic-s3-city-001--add-city-on-the-stable-platform)

Sprint stories: [user-stories.md](user-stories.md)

## Scope

- Freeze City mapping from family-neutral `ProfileDNA` and versioned
  `CitySceneConfig` contracts/fixtures.
- Create `services/city-service`, deployment `myunivokai-city`, database
  `myunivokai_city`, migrations, inbox/outbox and NATS permissions.
- Add City compose command, completion/failure events and query subjects without
  changing Universe/Nature consumer behavior.
- Build deterministic district/road/building/landmark composition.
- Add the high-fidelity desktop renderer, self-hosted asset manifest, licenses,
  lighting, atmosphere, camera and visual regression baseline.
- Extend gateway subject registry, Redis cache namespaces, frontend family
  selection, async flow, Compose and production deployment.
- Verify create/get/regenerate/select/publish/share and independent scaling.

## Definition of Done

- [ ] City contracts and fixed deterministic fixtures pass across Go/TypeScript.
- [ ] City data and credentials are isolated to `myunivokai_city` and City
      subjects.
- [ ] Existing Universe/Nature tests and deployed flows remain unchanged.
- [ ] The complete City lifecycle uses only the public gateway.
- [ ] Owner-approved desktop screenshots establish the high-fidelity baseline.
- [ ] Assets are self-hosted, licensed, catalogued and within recorded budgets.
- [ ] Local and deployed smoke plus monitoring pass.

## Out of scope

- mobile/weak-device quality reduction before the high tier is approved;
- auth/accounts;
- merging City into Universe/Nature;
- a new City-specific AI provider pipeline—City consumes canonical DNA.
