# Sprint 07 — create-form, transitions, gallery and ambient-audio polish

> **Starts:** 2026-08-28
> **Status:** Implemented — **five of six stories.** Corrected 2026-09-05:
> this line said "implementation absent" while its own
> [`user-stories.md`](user-stories.md) had marked five stories `Implemented`
> since 2026-08-29, on `fix/fe/sprint-07-experience-batch` and
> `feat/fe/world-entry-cinematics`. Only
> [`S7-FE-ADAPTIVE-001`](user-stories.md#s7-fe-adaptive-001--adaptive-quality-tiers-pulled-forward-ahead-of-city)
> is still `Planned`.
>
> **Not `Verified`:** the five carry their own caveat — *"Verified needs
> real-device/browser evidence beyond this session's own Playwright
> checks"* — and that evidence has not been collected.
> **Last source review:** 2026-09-05

## Sprint goal

Close the gap between how good the Universe/Forest/Ocean renderers already are
and how the surrounding product experience carries a visitor between them: the
create form's own layout, the cut between one world and the next, the
gallery's backdrop, the ambient soundscape, and — pulled forward from its
post-City slot by the owner — the device-quality tiers those renderers run at.
None of this touches a contract or a backend service; the renderer changes are
limited to per-device profile parameters, not new visuals.

Backlog epic:
[EPIC-S7-FE-EXPERIENCE-001](../../backlog/engineering-backlog.md#epic-s7-fe-experience-001--transition-form-and-ambience-polish-for-the-creategallery-experience)

Sprint stories: [user-stories.md](user-stories.md)

## Why this sprint exists

Unlike Sprints 1-6, no vision document predates this one. The scope comes from
a live source audit conducted directly against `apps/myunivokai-web` in a
planning conversation on 2026-08-28, the same basis
[scene-fidelity.md](../../backlog/scene-fidelity.md) and
[world-chrome.md](../../backlog/world-chrome.md) already use for
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
- Adaptive quality tiers for mobile and weak devices — GPU-tier classification
  at mount, a per-tier profile (DPR/shadow/postprocessing/LOD), a runtime
  `PerformanceMonitor` fallback, and a WebGL failure boundary — applied to the
  three shipped families (Universe/Forest/Ocean), with the existing approved
  high tier preserved pixel-identical.

## Decisions taken inside this sprint

1. **No new vision document.** The prior five sprints each executed a
   pre-existing `agent-system/vision/*-plan.md`. This one does not have one, and does
   not need one — the scope is small, FE-only, and fully specified by the
   stories below plus the source lines they cite.
2. **Sprint number and date are allocation, not calendar order**, same rule
   [../README.md](../README.md) already states for Sprint 4/5/6. This sprint
   is disjoint from Sprint 3 (City) and Sprint 2 (resilience/scale) — neither
   touches `apps/myunivokai-web`'s create/gallery/audio surface — so it costs
   neither of them any time.
3. **Adaptive GPU/mobile-weak-device quality tiers are pulled forward into
   this sprint.** [frontend-plan.md](../../frontend/frontend-plan.md) gap #4
   recorded an owner decision on 2026-07-19 to sequence this work after City.
   The owner reversed that sequencing on 2026-08-28: this sprint builds the
   tier system against the three families that already exist
   (Universe/Forest/Ocean) rather than waiting on City, which is unaffected
   because it will adopt the same tier system once it ships. The one
   constraint carried over unchanged: the current approved high tier must stay
   pixel-identical once tiers exist.

## Definition of Done

- [ ] Every Sprint 7 story below is Verified.
- [ ] No viewport between 360px and 1440px shows a create-form layout break
      named in S7-FE-RESPONSIVE-001 (orphaned card, missing mobile preview
      placard, or a below-`lg` treatment applied above 768px).
- [ ] Ocean's ambient mix and its visual depth cues cite the same
      `oceanDepthCurve.ts` output; no second depth table exists.
- [ ] `prefers-reduced-motion: reduce` disables every animation added by this
      sprint without breaking navigation.
- [ ] A visitor already reaching the tier-3/desktop GPU classification sees
      output pixel-identical to the pre-Sprint-7 fixed profile.

## Out of scope

- Any City work (Sprint 3) or resilience/scale work (Sprint 2) — disjoint
  services and surfaces. City will adopt this sprint's adaptive-tier system
  once it ships rather than needing to precede it.
- New family renderers, contracts, or backend services.
