import { CANONICAL_FALLBACK_SEED, planetsFromScene, randomFromSeed } from "@/lib/scene";
import { RARITY_CATALOGUE } from "@/lib/rarity";
import type { SceneConfig } from "@/lib/types";

/**
 * Seeded rare celestial events — the world lottery. Each feature rolls on its
 * OWN PRNG stream (`<seed>-rare-feature-<key>`), so adding, removing or
 * re-tuning one feature can never shift another feature's roll, and none of
 * the existing scene streams move.
 *
 * The HUD label is part of the contract: a rare roll nobody notices is a
 * wasted lottery. Both the world page and the share page surface displayName
 * via RareFeatureBadge whenever a feature is present.
 *
 * The probabilities and seed suffixes themselves now live in lib/rarity.ts,
 * the one table that also drives the admin app's observed-rate panel. Two
 * copies of "5%" would mean the dashboard could report a rate against a
 * probability this renderer stopped using.
 */

export type RareFeatureKey = "meteor-shower" | "binary-sun" | "black-hole";

export type RareFeatureDefinition = {
  key: RareFeatureKey;
  /** Shown in the HUD badge; app UI language is English. */
  displayName: string;
  probability: number;
  seedSuffix: string;
};

export const RARE_FEATURE_PROBABILITIES: RareFeatureDefinition[] = RARITY_CATALOGUE.filter(
  (feature) => feature.family === "universe"
).map((feature) => ({
  key: feature.key as RareFeatureKey,
  displayName: feature.label,
  probability: feature.probability,
  seedSuffix: feature.seedSuffix
}));

export function resolveRareFeatures(seed: string): RareFeatureDefinition[] {
  return RARE_FEATURE_PROBABILITIES.filter((definition) => {
    const random = randomFromSeed(`${seed}${definition.seedSuffix}`);
    return random() < definition.probability;
  });
}

/**
 * Scene-level resolution for HUD consumers (RareFeatureBadge): derives the
 * seed EXACTLY the way UniverseCanvas does, and returns nothing for worlds
 * without planets (those render the fallback renderer, which draws no rare
 * features). Today every planet-bearing theme resolves to
 * SolarSystemRenderer; when a second scene family joins the registry, this
 * helper is the single place to gate rare features by renderer.
 */
export function resolveRareFeaturesForScene(scene?: SceneConfig): RareFeatureDefinition[] {
  if (!scene || planetsFromScene(scene).length === 0) {
    return [];
  }
  return resolveRareFeatures(String(scene.seed ?? CANONICAL_FALLBACK_SEED));
}

export function hasRareFeature(rareFeatures: RareFeatureDefinition[], key: RareFeatureKey): boolean {
  return rareFeatures.some((feature) => feature.key === key);
}
