"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Plus } from "lucide-react";
import { addUnlessPresent, toggleItem } from "@/lib/formSelection";

export type ChipGroupWithCustomHandle = {
  /**
   * Commits a half-typed custom value through the same path the input's
   * `onBlur` uses, rather than relying on the browser to blur it. A caller
   * that is about to hide this group (the create page's form-rail collapse)
   * needs this: the draft would otherwise become unreachable the moment the
   * region goes invisible.
   */
  commitPendingCustomValue: () => void;
};

/** The two accent colors the create form's chip groups already used before
 * this component existed (Core Interests = primary, Traits = secondary) —
 * kept as a named choice rather than a free-form className so every group
 * stays on the house palette. */
type ChipGroupAccent = "primary" | "secondary";

const SELECTED_CHIP_CLASSNAME: Record<ChipGroupAccent, string> = {
  primary: "border-primary bg-primary/35 font-semibold text-paper",
  secondary: "border-secondary bg-secondary/30 font-semibold text-paper"
};

const CUSTOM_CHIP_CLASSNAME: Record<ChipGroupAccent, string> = {
  primary: "border-primary bg-primary/35",
  secondary: "border-secondary bg-secondary/30"
};

type ChipGroupWithCustomProps = {
  fieldLabel: string;
  predefinedOptions: string[];
  selected: string[];
  onChange: (updater: (current: string[]) => string[]) => void;
  minimumItems: number;
  maximumItems: number;
  minimumCharacters: number;
  maximumCharacters: number;
  customPlaceholder: string;
  customAriaLabel: string;
  /** Traits render lowercase values capitalized for display; interests don't. */
  capitalizeLabels?: boolean;
  accent?: ChipGroupAccent;
};

/**
 * One chip group: predefined pills, a visitor's own custom pills mixed into
 * the same selection array, and the control that adds one. Every group goes
 * through the same `toggleItem`/`addUnlessPresent` path, so a validation or
 * dedupe fix here applies everywhere at once instead of to whichever group
 * happened to get it first — see S7-FE-CUSTOMFORM-001.
 */
export const ChipGroupWithCustom = forwardRef<ChipGroupWithCustomHandle, ChipGroupWithCustomProps>(
  function ChipGroupWithCustom(
    {
      fieldLabel,
      predefinedOptions,
      selected,
      onChange,
      minimumItems,
      maximumItems,
      minimumCharacters,
      maximumCharacters,
      customPlaceholder,
      customAriaLabel,
      capitalizeLabels = false,
      accent = "primary"
    },
    ref
  ) {
    const [customDraft, setCustomDraft] = useState("");
    const [isAddingCustom, setIsAddingCustom] = useState(false);

    function toggle(item: string) {
      onChange((current) => toggleItem(current, item, minimumItems, maximumItems));
    }

    // Returns whether the draft was accepted; a too-short draft is kept on
    // screen for further typing rather than silently discarded.
    function commitCustomDraft(): boolean {
      const trimmed = customDraft.trim();
      if (trimmed.length < minimumCharacters) {
        return false;
      }
      onChange((current) => addUnlessPresent(current, trimmed, minimumItems, maximumItems));
      setCustomDraft("");
      return true;
    }

    function closeCustomInput() {
      commitCustomDraft();
      setCustomDraft("");
      setIsAddingCustom(false);
    }

    useImperativeHandle(ref, () => ({ commitPendingCustomValue: closeCustomInput }));

    const customItems = selected.filter((item) => !predefinedOptions.includes(item));
    const chipClassName = capitalizeLabels ? "capitalize" : "";

    return (
      <div className="grid gap-3">
        <span className="font-mono text-xs uppercase tracking-widest text-brass">{fieldLabel}</span>
        <div className="flex flex-wrap gap-2">
          {predefinedOptions.map((item) => {
            const isSelected = selected.includes(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className={`focus-ring tappable rounded-full border px-4 py-1.5 text-sm ${chipClassName} ${
                  isSelected
                    ? SELECTED_CHIP_CLASSNAME[accent]
                    : "border-white/15 bg-white/5 text-on-surface-variant hover:border-white/35 hover:text-on-surface"
                }`}
              >
                {item}
              </button>
            );
          })}
          {/* Custom items live in the same selection array as the predefined
              chips; clicking one removes it (the group's own minimum holds). */}
          {customItems.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed="true"
              onClick={() => toggle(item)}
              className={`focus-ring tappable rounded-full border px-4 py-1.5 text-sm font-semibold text-paper ${CUSTOM_CHIP_CLASSNAME[accent]} ${chipClassName}`}
            >
              {item}
            </button>
          ))}
          {isAddingCustom ? (
            <input
              autoFocus
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Enter adds the item; without this the form submits.
                  event.preventDefault();
                  commitCustomDraft();
                }
                if (event.key === "Escape") {
                  setCustomDraft("");
                  setIsAddingCustom(false);
                }
              }}
              onBlur={closeCustomInput}
              maxLength={maximumCharacters}
              placeholder={customPlaceholder}
              aria-label={customAriaLabel}
              className="focus-ring w-40 rounded-full border border-primary/50 bg-transparent px-4 py-1.5 text-sm text-on-surface placeholder:text-outline"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingCustom(true)}
              disabled={selected.length >= maximumItems}
              className="focus-ring tappable inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 bg-white/5 px-4 py-1.5 text-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Custom
            </button>
          )}
        </div>
      </div>
    );
  }
);
