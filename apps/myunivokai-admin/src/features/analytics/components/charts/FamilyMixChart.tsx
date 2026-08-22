"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChartConfig, ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { FAMILY_CHART_CONFIG } from "../../chart-config";
import { formatCount, formatPercent } from "../../format";
import type { FamilyTotals } from "../../types";

const PIE_CONFIG: ChartConfig = {
  worldCount: { label: "Worlds", color: "var(--chart-1)" }
};

// The split between Universe and Nature, with each family's own numbers beside
// it. A donut answers "which family is this platform actually generating" at a
// glance; the numbers beside it answer everything asked immediately afterwards,
// which a donut on its own cannot. Both halves come from the same query, so
// they can never disagree.
export function FamilyMixChart({
  families,
  isLoading = false
}: {
  families: FamilyTotals[];
  isLoading?: boolean;
}) {
  const totalWorlds = families.reduce((sum, family) => sum + family.worldCount, 0);

  return (
    <SectionCard
      title="Family mix"
      description="How the generated worlds divide between the two bounded contexts."
    >
      {isLoading ? (
        <Skeleton className="mt-4 h-[200px] rounded-lg" />
      ) : totalWorlds === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No worlds projected yet.</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
          <ChartContainer config={PIE_CONFIG} height={180}>
            <PieChart>
              <Tooltip
                content={
                  <ChartTooltipContent
                    config={PIE_CONFIG}
                    hideIndicator
                    labelFormatter={(label) => String(label ?? "")}
                    valueFormatter={(value) =>
                      `${formatCount(value)} · ${formatPercent((value / totalWorlds) * 100)}`
                    }
                  />
                }
              />
              <Pie
                data={families}
                dataKey="worldCount"
                nameKey="family"
                innerRadius="58%"
                outerRadius="86%"
                paddingAngle={2}
                strokeWidth={0}
                animationDuration={400}
              >
                {families.map((family) => (
                  <Cell
                    key={family.family}
                    fill={FAMILY_CHART_CONFIG[family.family]?.color ?? "var(--chart-4)"}
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>

          <div className="flex flex-col gap-3">
            {families.map((family) => (
              <div key={family.family}>
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 rounded-xs"
                    style={{ backgroundColor: FAMILY_CHART_CONFIG[family.family]?.color ?? "var(--chart-4)" }}
                  />
                  <span className="text-sm font-medium capitalize text-foreground">{family.family}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatPercent((family.worldCount / totalWorlds) * 100)}
                  </span>
                </div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <FamilyStat label="Worlds" value={formatCount(family.worldCount)} />
                  <FamilyStat label="Published" value={formatCount(family.publishedCount)} />
                  <FamilyStat label="Variants" value={formatCount(family.variantCount)} />
                  <FamilyStat
                    label="Jobs"
                    value={`${formatCount(family.jobCount)} · ${formatCount(family.failedJobCount)} failed`}
                  />
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function FamilyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
