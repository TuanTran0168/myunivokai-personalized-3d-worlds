import type { TraitScores } from "../types";

const TRAIT_LABELS: Array<[keyof TraitScores, string]> = [
  ["creativity", "Creativity"],
  ["discipline", "Discipline"],
  ["curiosity", "Curiosity"],
  ["energy", "Energy"],
  ["focus", "Focus"]
];

// Bars here, a radar on the dashboard, and that is a deliberate split rather
// than an inconsistency. The dashboard shows the mean across every world,
// where the question is the shape — which trait the population leans on — and
// a radar answers it in one glance. This page shows one person's world, where
// the question is the actual number, and a labelled bar states it without
// asking anyone to hover.
export function TraitBars({ scores }: { scores: TraitScores }) {
  return (
    <div className="flex flex-col gap-2.5">
      {TRAIT_LABELS.map(([key, label]) => (
        <TraitBar key={key} label={label} score={scores[key]} />
      ))}
    </div>
  );
}

// Trait scores are 0-100 from the DNA pipeline. The bar is clamped rather than
// trusted: a score outside that range is a bug upstream, and a bar wider than
// its track would hide it behind a layout glitch instead of showing the number.
function TraitBar({ label, score }: { label: string; score: number }) {
  const width = Math.max(0, Math.min(100, score));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground">{score}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
