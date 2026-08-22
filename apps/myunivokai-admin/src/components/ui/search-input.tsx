"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { FilterField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";

// Every other toolbar filter — FilterSelect, DateRangeFilter — commits on
// change because a <select> or a date picker has a natural commit point.
// Free text has none, so this debounces locally rather than firing one
// request per keystroke; the parent only ever sees the settled value.
const DEBOUNCE_MS = 300;

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The caption above the field. The placeholder says what to type; this says
   *  what the field is, and every screen's toolbar reads the same because of
   *  it — the placeholders differ per page and always will. */
  label?: string;
}) {
  const [draft, setDraft] = useState(value);

  // Re-seed from the committed value when it changes from outside this
  // input (e.g. a "clear filters" action elsewhere on the page).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) {
      return;
    }
    const timeout = setTimeout(() => onChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [draft, value, onChange]);

  return (
    <FilterField label={label} role="search">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-8 pr-8"
        />
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setDraft("")}
            className="absolute right-2 flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
    </FilterField>
  );
}
