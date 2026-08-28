# Sprint 07 — create-form, transitions, gallery and ambient-audio polish

> **Starts:** 2026-08-28
> **Status:** Planned; scope approved, implementation absent
> **Last source review:** 2026-08-28

## Sprint goal

Close the gap between how good the Universe/Forest/Ocean renderers already are
and how the surrounding product experience carries a visitor between them: the
create form's own layout, the cut between one world and the next, the
gallery's backdrop, and the ambient soundscape. None of this changes a family
renderer, a contract, or a backend service.

Backlog epic:
[EPIC-S7-FE-EXPERIENCE-001](../../user-stories/engineering-backlog.md#epic-s7-fe-experience-001--transition-form-and-ambience-polish-for-the-creategallery-experience)

Sprint stories: [user-stories.md](user-stories.md)

## Why this sprint exists

Unlike Sprints 1-6, no vision document predates this one. The scope comes from
a live source audit conducted directly against `apps/myunivokai-web` in a
planning conversation on 2026-08-28, the same basis
[scene-fidelity.md](../../user-stories/scene-fidelity.md) and
[world-chrome.md](../../user-stories/world-chrome.md) already use for
owner-requested work that did not originate in the original migration backlog.
Every claim below cites the file and line audited, not a redesign mockup.

## Scope

- A shared-element transition from a gallery world card into its full canvas,
  and a short camera settle when the create form's live preview switches
  family — both skipped under `prefers-reduced-motion: reduce`.
- One shared custom-value control for every create-form chip group, built on
  the existing `toggleItem`/`ensureRange` logic, replacing whatever per-group
  duplication the audit finds.
- Create-form responsive/layout fixes: a missing `md:` tablet tier, the
  orphaned third World Family card, the live-preview identity placard that
  currently never reaches a viewport below `lg`, a position indicator for the
  form's long internal scroll, and Palette swatch touch targets.
- The gallery's ambient backdrop reads the visitor's own most-recently-viewed
  saved world instead of a hard-coded Universe input, and may carry sound on
  that single backdrop canvas without reintroducing the multi-canvas conflict
  already documented in `UniverseCanvas.tsx`.
- Ocean's ambient soundscape mix derives from the same stored depth curve
  already driving its color/fog/god-rays, instead of a second, independent
  depth-to-audio table.

## Decisions taken inside this sprint

1. **No new vision document.** The prior five sprints each executed a
   pre-existing `notes/vision/*-plan.md`. This one does not have one, and does
   not need one — the scope is small, FE-only, and fully specified by the
   stories below plus the source lines they cite.
2. **Sprint number and date are allocation, not calendar order**, same rule
   [../README.md](../README.md) already states for Sprint 4/5/6. This sprint
   is disjoint from Sprint 3 (City) and Sprint 2 (resilience/scale) — neither
   touches `apps/myunivokai-web`'s create/gallery/audio surface — so it costs
   neither of them any time.

## Definition of Done

- [ ] Every Sprint 7 story below is Verified.
- [ ] No viewport between 360px and 1440px shows a create-form layout break
      named in S7-FE-RESPONSIVE-001 (orphaned card, missing mobile preview
      placard, or a below-`lg` treatment applied above 768px).
- [ ] Ocean's ambient mix and its visual depth cues cite the same
      `oceanDepthCurve.ts` output; no second depth table exists.
- [ ] `prefers-reduced-motion: reduce` disables every animation added by this
      sprint without breaking navigation.

## Out of scope

- **Adaptive GPU/mobile-weak-device quality tiers.** This stays gated behind
  City shipping by the owner's 2026-07-19 decision recorded in
  [frontend-plan.md](../../vision/frontend-plan.md) gap #4. Nothing in this
  sprint overrides that sequencing; a visitor on a weak device gets the
  responsive layout fixes in S7-FE-RESPONSIVE-001, not a lowered render tier.
- Any City work (Sprint 3) or resilience/scale work (Sprint 2) — disjoint
  services and surfaces.
- New family renderers, contracts, or backend services.
