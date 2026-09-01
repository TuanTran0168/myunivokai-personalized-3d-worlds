import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FOREST_STYLE_ANCIENT_GROVE,
  FOREST_STYLE_EMBERFALL,
  FOREST_STYLE_LANTERNWOOD,
  FOREST_STYLE_MISTWOOD,
  FOREST_STYLE_WILDWOOD
} from "./forestScene";
import {
  OCEAN_STYLE_CORAL_GARDEN,
  OCEAN_STYLE_CRYSTAL_SHOAL,
  OCEAN_STYLE_KELP_CATHEDRAL,
  OCEAN_STYLE_OPEN_WATER,
  OCEAN_STYLE_SILT_DRIFT
} from "./oceanScene";

/**
 * The world-style vocabulary is per family and the gateway returns 400 for one
 * family's style posted to another, so a value this app can produce and the
 * contract cannot accept is a create button that fails for a reason nobody can
 * see in the browser.
 *
 * Read out of contracts.go rather than restated here. A second hand-written
 * copy of a list is a list that drifts; this one fails the moment the Go set
 * changes without the TypeScript following it, which is the only failure mode
 * worth a test.
 */
const CONTRACTS_GO_PATH = join(process.cwd(), "..", "..", "contracts", "go", "contracts.go");

/** The style keys inside one family's block of allowedWorldStylesByFamily. */
function allowedStylesForFamily(familyConstant: string): string[] {
  const source = readFileSync(CONTRACTS_GO_PATH, "utf8");
  const tableStart = source.indexOf("var allowedWorldStylesByFamily");
  expect(tableStart, "allowedWorldStylesByFamily is no longer in contracts.go").toBeGreaterThan(-1);

  const familyStart = source.indexOf(`${familyConstant}: {`, tableStart);
  expect(familyStart, `${familyConstant} is not in allowedWorldStylesByFamily`).toBeGreaterThan(-1);

  const blockStart = source.indexOf("{", familyStart + familyConstant.length);
  const blockEnd = source.indexOf("\t},", blockStart);
  const block = source.slice(blockStart, blockEnd);
  return [...block.matchAll(/"([a-z0-9-]+)":/g)].map((match) => match[1]).sort();
}

describe("world styles mirror the Go contract", () => {
  it("offers the forest exactly the styles nature-service accepts", () => {
    const frontendStyles = [
      FOREST_STYLE_WILDWOOD,
      FOREST_STYLE_ANCIENT_GROVE,
      FOREST_STYLE_MISTWOOD,
      FOREST_STYLE_EMBERFALL,
      FOREST_STYLE_LANTERNWOOD
    ].sort();
    expect(frontendStyles).toEqual(allowedStylesForFamily("WorldFamilyNature"));
  });

  it("offers the ocean exactly the styles ocean-service accepts", () => {
    const frontendStyles = [
      OCEAN_STYLE_OPEN_WATER,
      OCEAN_STYLE_CORAL_GARDEN,
      OCEAN_STYLE_KELP_CATHEDRAL,
      OCEAN_STYLE_CRYSTAL_SHOAL,
      OCEAN_STYLE_SILT_DRIFT
    ].sort();
    expect(frontendStyles).toEqual(allowedStylesForFamily("WorldFamilyOcean"));
  });

  it("keeps every family's style vocabulary disjoint from the others", () => {
    // The property that makes a per-family set worth having. If two families
    // shared a name, switching family could leave a stored value that happens
    // to validate and means something entirely different in its new home.
    const universe = allowedStylesForFamily("WorldFamilyUniverse");
    const nature = allowedStylesForFamily("WorldFamilyNature");
    const ocean = allowedStylesForFamily("WorldFamilyOcean");
    const everyStyle = [...universe, ...nature, ...ocean];
    expect(new Set(everyStyle).size).toBe(everyStyle.length);
  });
});
