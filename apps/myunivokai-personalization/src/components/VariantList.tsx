"use client";

import { Check } from "lucide-react";
import type { World, WorldVariant } from "@/lib/types";

type VariantListProps = {
  world: World;
  activeVariantId?: string;
  busyVariantId?: string;
  onSelect: (variant: WorldVariant) => void;
};

export function VariantList({ world, activeVariantId, busyVariantId, onSelect }: VariantListProps) {
  return (
    <div className="grid gap-2">
      {world.variants.map((variant, index) => {
        const active = variant.id === activeVariantId;
        return (
          <button
            key={variant.id}
            type="button"
            onClick={() => onSelect(variant)}
            className={`focus-ring flex min-h-16 items-center justify-between rounded-md border px-3 py-2 text-left transition ${
              active ? "border-brass bg-brass/10" : "border-white/10 bg-surface-container/70 hover:border-white/25"
            }`}
            disabled={busyVariantId === variant.id}
          >
            <span>
              <span className="block text-sm font-semibold text-on-surface">{variant.title || variant.name || `Variant ${index + 1}`}</span>
              <span className="mt-1 block font-mono text-xs text-on-surface-variant">{variant.seed || variant.id}</span>
            </span>
            {active ? <Check className="h-5 w-5 text-brass" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full border border-white/25" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
