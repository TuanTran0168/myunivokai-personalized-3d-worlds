"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Every list screen used to hand-roll `flex flex-wrap items-center gap-2` in
// PageHeader's action slot, and every screen got a different result: Worlds
// wrapped onto two rows, Jobs onto two at a different breakpoint, Content mix
// onto one — so three pages had three header heights. Inside those rows the
// controls sized themselves to their own text, so "All families" and "Any"
// stood at two different widths in the same toolbar and nothing lined up.
//
// The fix is that a page no longer chooses a layout at all. It states which
// FIELDS it has; this file owns the row, the gaps, the caption style and the
// width. Two screens with the same fields are then identical by construction,
// not by two people remembering the same class list.
//
// Widths are named by ROLE rather than by size for the same reason: "this is
// the search field" stays true when the design changes, `w-48` does not.
const FIELD_WIDTHS = {
  filter: "w-full sm:w-44",
  search: "w-full sm:w-60",
  // Wide enough for two native date inputs plus the dash between them at
  // text-sm. Below that the browser truncates mm/dd/yyyy to an unreadable stub.
  range: "w-full sm:w-[20rem]"
} as const;

export type FilterFieldRole = keyof typeof FIELD_WIDTHS;

/**
 * The filter row, on its own line under PageHeader rather than beside the
 * title. Keeping it out of the title block is what makes the header height
 * independent of how many filters a screen has.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * One labelled control in the bar. The caption sits ABOVE the control instead
 * of beside it, which is what makes every field the same width regardless of
 * how long its label is — the previous inline labels meant "Published" and
 * "Family" produced two differently sized units out of the same component.
 *
 * The caption is a plain span, not a <label>: the range field holds two inputs
 * and a label may only ever name one control. Every control in this bar carries
 * its own aria-label instead, so the association survives either shape.
 */
export function FilterField({
  label,
  role = "filter",
  children
}: {
  label: string;
  role?: FilterFieldRole;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", FIELD_WIDTHS[role])}>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Pushes what follows to the right edge of the bar. Used for the one control
 * that is an action rather than a filter, so it does not sit in the middle of
 * the filter run pretending to be one.
 */
export function FilterBarSpacer() {
  return <div className="ml-auto" />;
}
