import { useEffect, useState } from "react";

/**
 * The value, held back until it has stopped changing for `delayMilliseconds`.
 *
 * Extracted from the create page, where it exists for one reason: every screen
 * that renders a live preview rebuilds a WebGL scene when its inputs change,
 * and a burst of keystrokes would tear down and recreate the GL context on
 * every character. The account page's backdrop is the second such screen, and
 * a second copy of four lines is how two previews come to debounce by
 * different amounts for no stated reason.
 */
export function useDebouncedValue<ValueType>(value: ValueType, delayMilliseconds: number): ValueType {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => clearTimeout(timeoutId);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}

/**
 * How long a live preview waits before rebuilding its scene.
 *
 * Long enough that typing a word rebuilds once rather than per character,
 * short enough that a chip toggle still feels immediate.
 */
export const PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS = 300;
