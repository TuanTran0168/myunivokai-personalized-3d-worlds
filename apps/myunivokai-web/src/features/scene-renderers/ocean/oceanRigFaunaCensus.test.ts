import { describe, expect, it } from "vitest";
import { OCEAN_RIG_SPECIES, speciesIsPresent } from "./oceanRigFauna";

/**
 * The census, as a contract.
 *
 * These exist because the population collapsed silently once already and nothing
 * caught it. The rig was GLB-only: a school was created invisible and became
 * visible when its `.glb` resolved, so a species without a model file could not
 * be declared at all. Four of the fourteen have no model — and they happened to
 * be the mass schools, so the rig rendered 396 animals where it should have
 * rendered 2550. Every unit test passed the whole time, because a missing animal
 * is not an error anywhere.
 */
describe("the ocean's census", () => {
  it("gives every species a body it can render without a download", () => {
    // The load-bearing invariant. A species whose only geometry source is a
    // network fetch is a species that does not exist when the fetch is slow, the
    // file is absent, or the deploy dropped the asset.
    for (const species of OCEAN_RIG_SPECIES) {
      expect(species.body, `${species.key} has no procedural body`).toBeTruthy();
      expect(species.color, `${species.key} has no colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("keeps the four schools that carry the population", () => {
    // Named individually rather than counted, because a count passes when one is
    // swapped for another and the point is these specific four: they are 2044 of
    // the rig's 2550 animals, and each one owns a depth band.
    const keys = OCEAN_RIG_SPECIES.map((species) => species.key);
    for (const key of ["silversides", "anthias", "lanternfish", "anglerfish"]) {
      expect(keys).toContain(key);
    }
  });

  it("populates every zone the depth axis can produce", () => {
    // A world can be at any depth, and "the water is empty here" must never be
    // the answer. Sampled across the whole range including the trench.
    for (const metres of [4, 8, 17, 40, 90, 142, 400, 900, 2448, 6000]) {
      const present = OCEAN_RIG_SPECIES.filter((species) =>
        // Worst case for population: no seabed and no surface in frame, which is
        // exactly the midwater column that used to render as an empty rectangle.
        speciesIsPresent(species, metres, false, false),
      );
      expect(present.length, `nothing lives at ${metres} m`).toBeGreaterThan(0);
    }
  });

  it("puts the mass schools where the frame needs them", () => {
    const at = (metres: number, seafloor: boolean, surface: boolean) =>
      OCEAN_RIG_SPECIES.filter((species) => speciesIsPresent(species, metres, seafloor, surface))
        .map((species) => species.key);

    // A reef is a reef because of the silversides cloud and the anthias colour.
    expect(at(8, true, true)).toContain("silversides");
    expect(at(8, true, true)).toContain("anthias");
    // The twilight zone is not empty: myctophids are the most abundant vertebrate
    // on Earth and they live exactly here.
    expect(at(142, false, false)).toContain("lanternfish");
    // And the abyss has its one light that is also a character.
    expect(at(2448, true, false)).toContain("anglerfish");
  });

  it("never lets a near-field species live where near-field colour is a lie", () => {
    // Near-field animals keep their own saturated colour, which is only honest
    // within a few metres of the lens. A near-field species drawn on a wide ring
    // in deep water would be a bright orange fish 60 m away through 40 m of
    // water — the exact kind of colour the medium is supposed to have taken.
    for (const species of OCEAN_RIG_SPECIES) {
      if (!species.nearField) continue;
      expect(species.pathRadius, `${species.key} rides too wide a ring`).toBeLessThanOrEqual(20);
      expect(species.maxDepthMetres, `${species.key} reaches too deep`).toBeLessThanOrEqual(90);
    }
  });
});
