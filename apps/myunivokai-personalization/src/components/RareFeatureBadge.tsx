import { Sparkles } from "lucide-react";
import type { SceneConfig } from "@/lib/types";
import { resolveRareFeaturesForScene } from "@/features/scene-renderers/solar-system/rareFeatures";

/**
 * Names the rare celestial event(s) this world rolled (meteor shower, binary
 * suns, ...). Rare features are a pure seed lottery — without a label nobody
 * would know they hit one — so the world page and the share page both show
 * this badge. Seed derivation and planet gating live in
 * resolveRareFeaturesForScene, shared with the renderer side, so the badge
 * always matches what the canvas actually draws.
 */

type RareFeatureBadgeProps = {
  scene?: SceneConfig;
};

export function RareFeatureBadge({ scene }: RareFeatureBadgeProps) {
  const rareFeatures = resolveRareFeaturesForScene(scene);
  if (rareFeatures.length === 0) {
    return null;
  }
  return (
    <p className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-brass">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Rare event: {rareFeatures.map((feature) => feature.displayName).join(" · ")}</span>
    </p>
  );
}
