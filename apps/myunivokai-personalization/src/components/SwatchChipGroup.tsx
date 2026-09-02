"use client";

import { Check, type LucideIcon } from "lucide-react";

export type SwatchOption = {
  label: string;
  value: string;
  swatch: string;
  /**
   * What the option IS, drawn rather than named. Required, not optional: an
   * icon that some options in a group have and others do not is worse than a
   * group with none, because the ones without read as unfinished.
   */
  Icon: LucideIcon;
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
  primary: "border-primary bg-primary/25 text-paper",
  secondary: "border-secondary bg-secondary/25 text-paper"
};

/** How much of the option's own colour tints the disc behind its icon. */
const ICON_DISC_TINT_PERCENTAGE = 24;

/**
 * A single-select group of chips: Atmospheric Mood and World Style, for every
 * family.
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
 * THE SWATCH IS NOW AN ICON on a disc of its own colour. It was a plain filled
 * dot, and the dot was honest about carrying no information — nobody picks
 * "Nebula" because of the purple — but a row of coloured dots asks the visitor
 * to know what "Mesophotic Current" or "Lanternwood" means from the label
 * alone. The icon is the only part of a chip that can answer that before it is
 * clicked. The colour stays, as the disc and the glyph, because it is what
 * makes the row scannable; dropping it made the group read as a second Traits.
 *
 * The checkmark is always in the DOM, opacity-toggled rather than
 * conditionally mounted, and the selected style drops the bold weight the
 * other chip groups use. Both are the same fix for the same bug: this group
 * is single-select, so picking a new option changes which TWO chips are
 * "selected" in one update. A checkmark that only exists when selected — or
 * text that only turns bold when selected — makes both of those chips change
 * WIDTH at once, and a width change on a flex-wrap row can shift where every
 * later chip wraps, jumping "Reef Crest" or "The Abyss" to a different line
 * for a reason that has nothing to do with them. Nothing about a chip's own
 * footprint may depend on whether it is the selected one, and that now
 * includes the icon: it is the same box in both states.
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
              className={`focus-ring tappable inline-flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-[13px] ${
                isSelected
                  ? SELECTED_CLASSNAME[accent]
                  : "border-white/15 bg-white/5 text-on-surface-variant hover:border-white/35 hover:text-on-surface"
              }`}
            >
              <span
                aria-hidden="true"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-white/20"
                style={{
                  backgroundColor: `color-mix(in srgb, ${option.swatch} ${ICON_DISC_TINT_PERCENTAGE}%, transparent)`,
                  color: option.swatch
                }}
              >
                <option.Icon className="h-3 w-3" strokeWidth={2.25} />
              </span>
              {option.label}
              <Check
                aria-hidden="true"
                className={`h-3.5 w-3.5 shrink-0 text-brass ${isSelected ? "opacity-100" : "opacity-0"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
