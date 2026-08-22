"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { expectedRate } from "@/components/ui/expected-rate";
import { RateAgainstTarget } from "@/components/ui/rate-against-target";
import { formatCount, formatPercent } from "../format";
import type { RarityFeatureRate } from "../types";

// One lottery: what it was aimed at, what it hit, whether the difference means
// anything, and a way into the worlds behind the number.
//
// The count sits next to the percentage everywhere on this card. A rare feature
// measured over a small population is mostly sampling noise, and a percentage
// alone gives a reader no way to tell 2-of-40 from 200-of-4000 — which is the
// difference between "ignore this" and "investigate this".
export function RarityFeatureCard({
  feature,
  scaleMaxPercent,
  worldsHref
}: {
  feature: RarityFeatureRate;
  scaleMaxPercent: number;
  worldsHref: string;
}) {
  const band = expectedRate(feature.configuredPercent, feature.eligibleWorlds, feature.observedPercent);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
              {feature.label}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tuned to {formatPercent(feature.configuredPercent)} · {feature.family}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-heading text-xl font-semibold tabular-nums text-foreground">
              {feature.eligibleWorlds === 0 ? "—" : formatPercent(feature.observedPercent)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatCount(feature.observedCount)} of {formatCount(feature.eligibleWorlds)} worlds
            </p>
          </div>
        </div>

        <RateAgainstTarget
          observedPercent={feature.observedPercent}
          targetPercent={feature.configuredPercent}
          eligibleWorlds={feature.eligibleWorlds}
          scaleMaxPercent={scaleMaxPercent}
        />

        <p className="text-[11px] text-muted-foreground">
          <ExpectationNote band={band} />
        </p>

        {feature.species && feature.species.length > 0 ? (
          <SpeciesBreakdown feature={feature} />
        ) : null}

        {/* The number is the question; this is the answer. A rate nobody can
            open is a picture — the same reason every distribution bar on
            Content mix is a link. */}
        {feature.observedCount > 0 ? (
          <Link
            href={worldsHref}
            className="inline-flex items-center gap-1 self-start text-xs text-primary transition-colors hover:text-primary/80"
          >
            Open the {formatCount(feature.observedCount)} worlds that rolled it
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Says, in words, what the shaded band on the bar means. The band alone is a
// grey rectangle nobody can interpret, and the whole point of it is to stop a
// reader concluding "broken" from a difference that is ordinary.
function ExpectationNote({ band }: { band: ReturnType<typeof expectedRate> }) {
  switch (band.kind) {
    case "no-worlds":
      return <>No world in this window could roll it.</>;
    case "too-few":
      return (
        <>
          Too few worlds to read a rate from — around {formatCount(band.worldsNeeded)} would settle it.
        </>
      );
    case "range":
      return band.withinExpectation ? (
        <>
          Ordinary: a correct lottery lands between {formatPercent(band.lowPercent)} and{" "}
          {formatPercent(band.highPercent)} at this sample size.
        </>
      ) : (
        <span className="text-destructive">
          Outside the {formatPercent(band.lowPercent)}–{formatPercent(band.highPercent)} a correct
          lottery would produce here 95% of the time.
        </span>
      );
  }
}

// Which variety the worlds that DID hit ended up with. Bars rather than a
// donut: the varieties are meant to be uniform, so the question is "are these
// four the same length", and a bar chart answers that at a glance where a pie
// asks the reader to compare wedge angles.
function SpeciesBreakdown({ feature }: { feature: RarityFeatureRate }) {
  const species = feature.species ?? [];
  const widest = Math.max(...species.map((entry) => entry.percentOfHits), 1);
  return (
    <div className="border-t border-border/60 pt-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        Which one, of the {formatCount(feature.observedCount)} that hit
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {species.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs text-foreground">{entry.label}</span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-accent/40">
              <span
                aria-hidden
                className="block h-full rounded-full bg-chart-2 transition-[width] duration-500 ease-out"
                style={{ width: `${(entry.percentOfHits / widest) * 100}%` }}
              />
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatCount(entry.count)}
              <span className="ml-1.5">{formatPercent(entry.percentOfHits)}</span>
            </span>
          </li>
        ))}
      </ul>
      {feature.observedCount === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Nothing has rolled this feature yet, so no variety has come up.
        </p>
      ) : (
        <Badge variant="outline" className="mt-2 text-[10px]">
          Each variety is meant to be equally likely
        </Badge>
      )}
    </div>
  );
}
