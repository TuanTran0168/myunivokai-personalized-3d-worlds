import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RARITY_CATALOGUE, rarityRolls } from "./rarity";

/**
 * The lottery's cross-language contract, in executable form.
 *
 * A rare feature is decided here, in TypeScript, at render time. The admin
 * app's observed-rate panel is computed in Go, in analytics-service, by
 * replaying the same draws over the seeds of real worlds. Those two
 * implementations have no compiler between them: a one-character change to the
 * hash, the shift order or a seed suffix would leave both sides working and
 * quietly disagreeing about which worlds hit a black hole.
 *
 * This fixture is the only thing that notices. It records RAW DRAWS rather
 * than resolved features, so re-tuning a probability leaves it untouched and it
 * fails only when the lottery itself moves — which is exactly the change that
 * should be deliberate.
 *
 * Regenerate deliberately with:
 *
 *   UPDATE_GOLDEN=1 npx vitest run src/lib/rarityGolden.test.ts
 *
 * and then run contracts/go's TestRarityRollsMatchTheRendererFixture, which
 * reads the same file.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL("../../../../contracts/fixtures/rarity/rare-feature-rolls.v1.json", import.meta.url)
);

// Real-shaped seeds: universe-service emits `WLD-<10 base32>` for a world's
// first variant and `VAR-<3>-<n>-<4 base32>` for the ones added later, and both
// shapes have to hash the same on both sides. The last two are deliberately
// degenerate — an empty seed and a non-ASCII one — because those are where a
// byte-vs-UTF-16 port would diverge and nothing else would show it.
const GOLDEN_SEEDS = [
  "WLD-ABC1234567",
  "WLD-ZZZZZZZZZZ",
  "VAR-A1B-2-QRST",
  "VAR-000-11-ZZZZ",
  "myunivokai",
  "",
  "seed-với-dấu"
];

type RarityGoldenFixture = {
  catalogue: {
    key: string;
    family: string;
    probability: number;
    seedSuffix: string;
    species: string[];
  }[];
  rolls: {
    variantSeed: string;
    draws: { feature: string; roll: number; speciesRoll?: number }[];
  }[];
};

function buildFixture(): RarityGoldenFixture {
  return {
    catalogue: RARITY_CATALOGUE.map((feature) => ({
      key: feature.key,
      family: feature.family,
      probability: feature.probability,
      seedSuffix: feature.seedSuffix,
      species: (feature.species ?? []).map((species) => species.key)
    })),
    rolls: GOLDEN_SEEDS.map((variantSeed) => ({ variantSeed, draws: rarityRolls(variantSeed) }))
  };
}

describe("the rare-feature golden fixture", () => {
  it("matches what this renderer draws", () => {
    const built = `${JSON.stringify(buildFixture(), null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === "1") {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, built, "utf8");
      return;
    }
    // The repo checks files out with CRLF on Windows; normalize so this is a
    // comparison about content, not line endings.
    const stored = readFileSync(FIXTURE_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(built).toBe(stored);
  });
});
