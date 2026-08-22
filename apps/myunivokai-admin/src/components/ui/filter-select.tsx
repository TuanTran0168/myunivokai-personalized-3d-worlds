"use client";

import { FilterField } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// A labelled Base UI select for the toolbar filters. It lives here rather
// than beside a page because five screens use it — worlds, jobs, fleet,
// content mix and the telemetry shell — and it previously lived inside
// DashboardPage.tsx, which meant three pages imported a control out of a
// fourth page. A page is not a module boundary, and importing across pages is
// how a "small tweak to the dashboard" silently changes the jobs toolbar.
//
// Built on the same @base-ui/react/select primitive as select.tsx rather than
// a native <select>: these lists are short, but the native control cannot be
// styled or animated to match the rest of the toolbar, which read as flat and
// out of place next to it.
//
// It renders its own FilterField rather than letting the caller wrap it. The
// caller then has no way to give this control a different width from the one
// beside it, which is exactly the drift that made the toolbars ragged.
export function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
}) {
  return (
    <FilterField label={label}>
      <Select value={value} onValueChange={(nextValue) => onChange(nextValue ?? "")}>
        {/* w-full defeats the primitive's own w-fit, which is what let every
            trigger size itself to its longest option and left the row ragged. */}
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue>
            {(currentValue: string) => options.find((option) => option.value === currentValue)?.label ?? options[0]?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}
