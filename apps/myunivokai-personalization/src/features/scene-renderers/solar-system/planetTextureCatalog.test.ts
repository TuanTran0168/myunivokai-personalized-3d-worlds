import { describe, expect, it } from "vitest";
import {
  PLANET_TEXTURE_CATALOG,
  buildPlanetTextureAssignment,
  planetTextureEntryForIndex
} from "./planetTextureCatalog";

const SAMPLE_SEED = "test-world-seed-textures-5";
const CATALOG_LENGTH = PLANET_TEXTURE_CATALOG.length;
const EXPANDED_POOL_MINIMUM_ENTRY_COUNT = 14;

describe("PLANET_TEXTURE_CATALOG", () => {
  it("holds the expanded texture pool", () => {
    expect(CATALOG_LENGTH).toBeGreaterThanOrEqual(EXPANDED_POOL_MINIMUM_ENTRY_COUNT);
  });

  it("only flags fiction-role surfaces as tintable", () => {
    for (const entry of PLANET_TEXTURE_CATALOG) {
      if (entry.allowsPaletteTint) {
        expect(entry.planetStyleName).toMatch(/^dwarf-/);
      }
    }
  });

  it("keeps the earth-like role out of the procedural ring lottery", () => {
    const earthLikeEntry = PLANET_TEXTURE_CATALOG.find((entry) => entry.planetStyleName === "earth-like");
    expect(earthLikeEntry?.excludeFromProceduralRing).toBe(true);
  });
});

describe("planetTextureEntryForIndex", () => {
  it("wraps modulo the catalog length", () => {
    expect(planetTextureEntryForIndex(CATALOG_LENGTH)).toBe(PLANET_TEXTURE_CATALOG[0]);
    expect(planetTextureEntryForIndex(CATALOG_LENGTH + 2)).toBe(PLANET_TEXTURE_CATALOG[2]);
  });
});

describe("buildPlanetTextureAssignment", () => {
  it("returns the identical assignment for the same seed", () => {
    const firstAssignment = buildPlanetTextureAssignment(SAMPLE_SEED, 8);
    const secondAssignment = buildPlanetTextureAssignment(SAMPLE_SEED, 8);
    expect(secondAssignment).toEqual(firstAssignment);
  });

  it("varies across different seeds", () => {
    const serializedAssignments = new Set(
      Array.from({ length: 30 }, (_, seedIndex) =>
        JSON.stringify(buildPlanetTextureAssignment(`${SAMPLE_SEED}-variety-${seedIndex}`, 8))
      )
    );
    expect(serializedAssignments.size).toBeGreaterThan(1);
  });

  it("keeps every assigned index inside the catalog", () => {
    for (const planetCount of [1, 4, 8, CATALOG_LENGTH, CATALOG_LENGTH + 4]) {
      const assignment = buildPlanetTextureAssignment(SAMPLE_SEED, planetCount);
      expect(assignment.length).toBe(planetCount);
      for (const catalogIndex of assignment) {
        expect(catalogIndex).toBeGreaterThanOrEqual(0);
        expect(catalogIndex).toBeLessThan(CATALOG_LENGTH);
      }
    }
  });

  it("never repeats a style until the whole pool has been used", () => {
    const assignment = buildPlanetTextureAssignment(SAMPLE_SEED, CATALOG_LENGTH);
    expect(new Set(assignment).size).toBe(CATALOG_LENGTH);
  });

  it("wraps back to the shuffled order beyond the pool", () => {
    const assignment = buildPlanetTextureAssignment(SAMPLE_SEED, CATALOG_LENGTH + 3);
    expect(assignment[CATALOG_LENGTH]).toBe(assignment[0]);
    expect(assignment[CATALOG_LENGTH + 1]).toBe(assignment[1]);
    expect(assignment[CATALOG_LENGTH + 2]).toBe(assignment[2]);
  });
});
