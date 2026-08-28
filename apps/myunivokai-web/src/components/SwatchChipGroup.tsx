"use client";

import { Check } from "lucide-react";

export type SwatchOption = {
  label: string;
  value: string;
  swatch: string;
};

type SwatchChipGroupProps = {
  fieldLabel: string;
  options: readonly SwatchOption[];
  selected: string;
  onSelect: (value: string) => void;
  /** Ring/border colour of the selected chip. Mood and World Style differ. */
  accent?: "secondary" | "primary";
};

const SELECTED_CLASSNAME: Record<NonNullable<SwatchChipGroupProps["accent"]>, string> = {
  primary: "border-primary bg-primary/25 font-semibold text-paper",
  secondary: "border-secondary bg-secondary/25 font-semibold text-paper"
};

/**
 * A single-select group of coloured chips: Atmospheric Mood and World Style.
 *
 * Both were grids of cards — an h-8 colour bar with a label under it, in a
 * two- or three-column grid — and between them they were 464px of a form whose
 * whole scrollport is 508px on a 900px-tall laptop. Thirty-five percent of the
 * form, for nine words and nine colours.
 *
 * As chips they are 224px, and the shape is the one the form already uses for
 * Core Interests and Traits, so the page reads as one control vocabulary
 * instead of three. FLEX-WRAP rather than a grid, and that is deliberate: a
 * two-column grid orphans the fifth World Style on a row of its own, and the
 * ocean's "Mesophotic Current" needs more width than "Void" does. A cloud has
 * no orphans and gives each label the width its own text asks for.
 *
 * The swatch survives as a dot. It was never carrying information the label
 * did not — nobody picks "Nebula" because of the purple — but it is what makes
 * the row scannable, and dropping it entirely made the group read as a second
 * Traits.
 */
export function SwatchChipGroup({
  fieldLabel,
  options,
  selected,
  onSelect,
  accent = "secondary"
}: SwatchChipGroupProps) {
  return (
    <div className="grid gap-2.5">
      <span className="font-mono text-xs uppercase tracking-widest text-brass">{fieldLabel}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={isSelected}
              className={`focus-ring tappable inline-flex items-center gap-2 rounded-full border py-1.5 pl-2 pr-3.5 text-[13px] ${
                isSelected
                  ? SELECTED_CLASSNAME[accent]
                  : "border-white/15 bg-white/5 text-on-surface-variant hover:border-white/35 hover:text-on-surface"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-white/25"
                style={{ backgroundColor: option.swatch }}
              />
              {option.label}
              {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-brass" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
