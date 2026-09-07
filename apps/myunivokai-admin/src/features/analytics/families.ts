import type { ChartConfig } from "@/components/ui/chart";
import type { WorldFamily } from "./types";

// The one list of world families this app knows about, and the reason it is a
// list rather than three copies of the same array literal.
//
// `FAMILY_OPTIONS` was declared verbatim in OverviewPage, ContentMixPage and
// RarityPage, and `FAMILY_CHART_CONFIG` held its own second copy of the labels.
// Ocean shipped to production in Sprint 6 and was missing from **all four** —
// not because anyone decided to leave it out, but because adding a family meant
// finding four places and nothing pointed at the other three. An ocean world
// was returned by the API, listed in the tables, and unselectable in every
// filter above them.
//
// So the next family is one entry here. The colour lives here too, for the same
// reason: a family that is brass in the mix chart and grey in the legend has two
// identities on one screen.
export const WORLD_FAMILIES: { value: WorldFamily; label: string; color: string }[] = [
  { value: "universe", label: "Universe", color: "var(--chart-2)" },
  { value: "nature", label: "Nature", color: "var(--chart-3)" },
  { value: "ocean", label: "Ocean", color: "var(--chart-1)" }
];

// The empty value is "no filter", which the gateway already treats as "every
// family" — it is not a family and deliberately has no entry above.
export const ALL_FAMILIES_FILTER_VALUE = "" as const;

export const FAMILY_FILTER_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: ALL_FAMILIES_FILTER_VALUE },
  ...WORLD_FAMILIES.map((family) => ({ label: family.label, value: family.value }))
];

// Derived rather than declared, so a family cannot exist in the filter and be
// missing from the chart.
export const FAMILY_CHART_CONFIG: ChartConfig = Object.fromEntries(
  WORLD_FAMILIES.map((family) => [family.value, { label: family.label, color: family.color }])
);
