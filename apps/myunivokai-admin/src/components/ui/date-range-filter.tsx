"use client";

import { FilterField } from "@/components/ui/filter-bar";

// A "since" / "until" pair of native date inputs for the toolbar filters.
// Values are plain "YYYY-MM-DD" strings (the native <input type="date">
// format) or "" for no bound — converting that to a request's RFC3339
// instant is the caller's job, the same way each feature already converts
// its own filters into a query string.
//
// The two inputs share ONE field with one caption. They used to carry inline
// "From" and "To" labels, which made this unit a different width from every
// select beside it and was the single biggest reason the toolbars looked
// ragged; the dates themselves already read as a range.
const DATE_INPUT_CLASSES =
  "h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function DateRangeFilter({
  since,
  until,
  onSinceChange,
  onUntilChange,
  label = "Date range"
}: {
  since: string;
  until: string;
  onSinceChange: (value: string) => void;
  onUntilChange: (value: string) => void;
  label?: string;
}) {
  return (
    <FilterField label={label} role="range">
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label={`${label} from`}
          className={DATE_INPUT_CLASSES}
          value={since}
          max={until || undefined}
          onChange={(event) => onSinceChange(event.target.value)}
        />
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          –
        </span>
        <input
          type="date"
          aria-label={`${label} to`}
          className={DATE_INPUT_CLASSES}
          value={until}
          min={since || undefined}
          onChange={(event) => onUntilChange(event.target.value)}
        />
      </div>
    </FilterField>
  );
}
