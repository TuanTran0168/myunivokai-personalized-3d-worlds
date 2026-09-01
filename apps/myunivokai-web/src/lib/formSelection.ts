/**
 * Selection helpers for the create form's chip groups, extracted verbatim from
 * app/page.tsx so their behavior can be locked by tests. Do NOT "improve" the
 * semantics here without a deliberate decision: the payload sent to the
 * backend (and therefore the deterministic preview seed) depends on them.
 */

/**
 * Toggles `item` in `current`: removing is refused at `min` items, adding is
 * refused at `max` items. Adding an already-present item is a no-op removal
 * guard, which also makes it safe for custom (free-text) entries — duplicates
 * cannot be added twice.
 */
export function toggleItem(current: string[], item: string, min: number, max: number) {
  if (current.includes(item)) {
    return current.length <= min ? current : current.filter((value) => value !== item);
  }
  return current.length >= max ? current : [...current, item];
}

/**
 * Trims, dedupes (first occurrence wins) and caps `values` at `max`; when the
 * selection is below `min`, pads with `defaults` just far enough to reach it.
 *
 * The user's selection is submitted as-is: choosing 3 non-default interests
 * sends exactly those 3. (Until 2026-07 the defaults were ALWAYS merged in —
 * the form silently invented values the user never picked. Fixed as the
 * form-validation item of the refactor plan; the payload and preview seed for
 * NEW worlds change, stored worlds are untouched.)
 */
export function ensureRange(values: string[], defaults: string[], min: number, max: number) {
  const cleanedSelection = Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
  const padded = [...cleanedSelection];
  for (const defaultItem of defaults) {
    if (padded.length >= min) {
      break;
    }
    const trimmedDefault = defaultItem.trim();
    if (trimmedDefault && !padded.includes(trimmedDefault)) {
      padded.push(trimmedDefault);
    }
  }
  return padded.slice(0, max);
}

/**
 * Adds `item` unless it is already present. Used when committing a typed
 * custom value: `toggleItem` alone treats "already selected" as a toggle-OFF,
 * which would remove an existing chip the moment a visitor typed and
 * submitted its exact text as a "new" custom value instead of leaving it
 * selected.
 */
export function addUnlessPresent(current: string[], item: string, min: number, max: number) {
  return current.includes(item) ? current : toggleItem(current, item, min, max);
}
