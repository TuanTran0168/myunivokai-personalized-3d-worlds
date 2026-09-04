# Sprint 03 — City vertical slice

> **Starts:** 2026-09-09 (moved from 2026-08-19 on 2026-08-15, when the owner brought the Ocean family forward — see Sprint 06)
> **Status:** Planned; starts only after Sprint 2 gates. One folded-in section is
> already Implemented — see **Folded in: chrome and identity surfaces** below
> **Last source review:** 2026-09-03

## Sprint goal

Add City as a new independent bounded context on the proven platform and ship a
high-fidelity desktop vertical slice from canonical DNA through public share.

Backlog epic: [EPIC-S3-CITY-001](../../backlog/engineering-backlog.md#epic-s3-city-001--add-city-on-the-stable-platform)

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

## Folded in: chrome and identity surfaces

Frontend-only work on the credential screens, the account menu and the toast
surface, folded into this sprint on the owner's instruction rather than given a
sprint of its own. It touches none of City's services, contracts, databases or
subjects, so it neither blocks City nor is blocked by it — and City's renderer
inherits its one durable output, the rule that decides which of the two glass
materials a surface wears.

Stories, and the five corrections written after the work, are in
[user-stories.md](user-stories.md#chrome-and-identity-surfaces).

**It also uncovered `S3-CSP-001`, fixed 2026-09-04 on
`fix/fe/content-security-policy-hydration`**: nothing hydrated on a production
build, on `staging` as much as here, because a prerendered page carries no nonce
and the middleware's policy demands one.

**It was a release blocker for Sprint 08, not a footnote to City**, and this
paragraph previously undersold it as something to read before verifying the City
slice. Sprint 08 is marked "every story is implemented", and on 2026-09-04
`origin/main` was **46 commits** behind `staging` with none of it deployed — so
the defect was latent purely because production predated the middleware that
causes it. The first merge of `staging` into `main` would have turned it into a
total outage: every route but the three share pages, with no error thrown
anywhere. City's own acceptance still inherits the benefit — an interactive page
on a production build now works — but the reason to fix it first was the release,
not the sprint after it.

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
