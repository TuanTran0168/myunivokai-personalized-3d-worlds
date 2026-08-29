# Scene fidelity backlog — forest family

> **Document status:** Active backlog for unplanned owner-requested visual work
> **Last source review:** 2026-07-29

The forest renderer has absorbed several rounds of owner-driven realism work
that no story covered. This file exists so that work stops being invisible: it
is not part of [EPIC-S1-MIGRATE-001](engineering-backlog.md), it is not in any
sprint commitment, and it competes for the same time as
[S1-SECURITY-001](../sprints/sprint-01-2026-07-22/user-stories.md), which is
marked *required before production cutover*.

Recording it does not approve it. Sequencing is the owner's call.

## US-FOREST-001 — A lake that reads as a lake

Status: Implemented
Priority: Unranked — owner-requested outside sprint scope

As a Nature world owner,
I want the water at the centre of my forest to read as a lake,
so that the scene looks like a place rather than a diagram of one.

The acceptance below is written after the fact, from the owner feedback that
drove each round. It is the definition of done this work never had — which is
why six rounds of shape, scale, palette and wave changes each ended in "still
looks like a puddle". Every criterion is measurable without a screenshot,
because the implementer cannot see the render.

Scenario: The water dominates the opening view

Given a forest scene built from any DNA seed
When the world page first renders
Then the water occupies at least a third of the frame height
And the camera stands on dry land outside the shoreline
And no tree stands between the camera and the water
And the view crosses the water below 18 degrees rather than looking down onto it.

Scenario: The shoreline is not a circle

Given the seeded water outline
When its perimeter is compared with a circle of equal area
Then the shoreline development index exceeds 1.15
And the shoreline stays smooth (peak second derivative of the radius function
under 50), so the index is not bought with jagged notches.

Scenario: The surface behaves like water

Given the animated surface mesh
When the wave displacement is applied at any time sample
Then no triangle inverts (the Gerstner lateral shift never exceeds local vertex
spacing)
And the bed is visible through the water, because a near-normal view reflects
about 2% and cannot be rescued with a mirror.

Source evidence:

- `apps/myunivokai-web/src/features/scene-renderers/forest/forestMath.ts`
- `apps/myunivokai-web/src/features/scene-renderers/forest/ForestPondWater.tsx`
- `apps/myunivokai-web/src/features/scene-renderers/forest/ForestTerrain.tsx`
- `apps/myunivokai-web/src/features/scene-renderers/forest/forestMath.test.ts`
- `agent-system/plans/frontend/forest-realism-roadmap.md`

Tasks:

- [x] Size and carve the lake basin so the surface stays planar (PR #85).
- [x] Give the shoreline bays, headlands and islands (PR #85).
- [x] Replace the reflector with a translucent surface over a painted bed (PR #85).
- [x] Replace summed sines with Gerstner waves; prove no mesh folding (PR #85).
      **Corrected on `feat/fe/forest-fidelity-metrics`:** that proof was an
      argument, not a measurement, and it was wrong for the landmark ponds. Once
      US-FOREST-002 turned it into a test, triangles were inverting on the
      1.7-unit pond on real seeds. Now clamped and asserted.
- [x] Open the camera from the bank instead of above the middle
      (`feat/fe/forest-lake-framing`).

## US-FOREST-002 — Judge fidelity against something other than opinion

Status: Implemented on `feat/fe/forest-fidelity-metrics`
Priority: Was unranked; approved and executed 2026-08-02

As the implementer,
I want each fidelity change checked against a stated measurement,
so that rounds end in evidence instead of another screenshot exchange.

Scenario: A fidelity change states its own test

Given a change to forest geometry, framing or materials
When it is proposed
Then it names the property it improves and how that property is measured
And the measurement lands in a test, not only in a note.

Notes:

- The metrics used so far — SDI plus a smoothness "kink" metric, triangle-fold
  counts, frame-share of water, sight-line occlusion — are recorded in
  `agent-system/plans/frontend/forest-realism-roadmap.md`.
- SDI on its own is gameable: it was once pushed to 1.58 with high harmonics and
  produced a worse, jagged shape. Any single metric needs its counterweight.

Tasks:

- [x] Frame-share of water and camera sight-lines — already in
      `forestMath.test.ts` before this story; verified 2026-08-02.
- [x] Shoreline development index and its kink counterweight, in
      `forestFidelityMetrics.ts` and its test.
- [x] Extract the wave field out of `ForestPondWater.tsx` into
      `forestWaterMath.ts`, so it can be measured at all.
- [x] Triangle-inversion test across every surface size, seed and time sample —
      which found and fixed a real fold on the landmark ponds.

What the measurements say:

- Shipped shoreline over 4000 seeds: development index 1.155-1.197, kink 7.9-17.8.
  The index floor clears its 1.15 threshold by about 0.005, so that threshold is a
  live constraint and not slack.
- The gaming failure is now itself a test. A high-harmonic outline scores 2.04 on
  the index — far better than what ships — and the kink metric rejects it at 82.
- The published fold metric was wrong as written. "Lateral shift never exceeds
  local vertex spacing" is a proxy that fails in both directions: it reads as a
  fold across open water, where nothing is wrong, and it passed the pond, which
  folded. The test measures signed triangle area instead.
- Full execution record: [../fe/deferred-work-plan.md](../../memory/execution-records/frontend-deferred-work.md)
  Part B.

## Known limits, accepted deliberately

- The opening camera loses its foreground strip of bank on about 10% of seeds,
  where the standoff hits the clamp that keeps it inside the tree-free bank.
- An islet interrupts the far water on about 19% of seeds. Always past the lake
  centre, so the near half always reads; overlapping silhouettes are a depth cue,
  so this is left alone.
- Off-axis sight lines can cross a bay that recedes further than the bank, where
  a shore tree may stand in front of the water. Fixing it needs a tree-free band
  as wide as the deepest bay, which costs most of the forest.
- Birch, dead trees and snow pine remain stylized.
