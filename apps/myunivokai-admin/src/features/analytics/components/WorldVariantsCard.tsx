"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Dices } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminApiError } from "@/lib/admin-http";
import { analyticsApi } from "../api";

// The variants behind a world, and what each one's seed is for.
//
// This is a second request rather than a field on the world detail, because it
// is a second permission: the gateway gates it on `variant:read` while the
// detail above is `world:read`. A holder of one and not the other gets exactly
// what they are allowed, which is what a per-resource verb is supposed to buy.
//
// It is fetched lazily by being a component the page only renders when the
// permission is held — a query that 403s on every load would fill the console
// with a failure nobody can act on.
export function WorldVariantsCard({ worldId }: { worldId: string }) {
  const variantsQuery = useQuery({
    queryKey: ["analytics", "world", worldId, "variants"],
    queryFn: () => analyticsApi.worldVariants(worldId),
    // A 404 here is the same stale link the world detail already handles, and
    // asking three more times does not fix it.
    retry: (failureCount, error) =>
      !(error instanceof AdminApiError && error.status === 404) && failureCount < 2
  });

  const variants = variantsQuery.data?.variants ?? [];

  return (
    <SectionCard
      title="Variants"
      description="Each variant this world holds, and the seed it was drawn from. The seed is what the rare-feature lottery replays against, so it is what makes a rarity claim checkable rather than believable."
    >
      {variantsQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="The variants are unavailable"
          description="analytics-service answered the world but not its variants. It may be starting up."
        />
      ) : variantsQuery.isLoading ? (
        <Skeleton className="mt-3 h-[72px] rounded-lg" />
      ) : variants.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No variant is recorded for this world. Projections written before variants crossed the
          data boundary read as empty here, and refill on the next change that world publishes.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {variants.map((variant) => (
            <li
              key={variant.variantNo}
              className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
            >
              <span className="flex items-center gap-2 text-xs text-foreground">
                {variant.isSelected ? (
                  <Check className="size-3.5 text-primary" aria-label="selected" />
                ) : (
                  <Dices className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                Variant {variant.variantNo}
                {variant.isSelected ? (
                  <span className="text-xs text-muted-foreground">· shown to visitors</span>
                ) : null}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {variant.seed || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
