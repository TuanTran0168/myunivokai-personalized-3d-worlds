"use client";

import { useEffect, useState } from "react";
import { webgpuAdapterAvailabilityOnce, type WebGPUAdapterAvailability } from "./webgpuSupport";

/**
 * WHAT `navigator.gpu` SAID, AS A PIECE OF REACT STATE THE CANVAS CAN WAIT ON.
 *
 * `rendererSelection.ts` needs this answer BEFORE the canvas is built, because
 * the renderer is created by the `gl` factory and React calls that once per
 * `<Canvas>`. There is no such thing as changing a renderer afterwards — only
 * throwing the canvas away and building another, which is this app's single
 * most expensive operation and the one the whole sprint was spent shortening.
 *
 * # Why returning null first is not a flash
 *
 * The canvas is already held at `opacity-0` until the scene signals ready, and
 * readiness is 2.4 to 3.6 s away on the fixtures §26 Phase 13 measured. The wait
 * this hook adds is one `requestAdapter()` — 1 to 15 ms in Phase 0's numbers,
 * bounded by `WEBGPU_ADAPTER_PROBE_TIMEOUT_MILLISECONDS` — inside a window the
 * visitor is already looking at a placeholder for. Nothing moves on screen that
 * was not already still.
 *
 * # Why it is an effect and not a render-time read
 *
 * `navigator` does not exist on the server. Reading it during render would make
 * the first client render disagree with the markup that was sent, on the page's
 * most expensive component — and a hydration mismatch there re-renders the
 * canvas, which is the cost this exists to avoid paying twice.
 */
export function useWebGPUAdapterAvailability(enabled: boolean): WebGPUAdapterAvailability | null {
  const [availability, setAvailability] = useState<WebGPUAdapterAvailability | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void webgpuAdapterAvailabilityOnce().then((answer) => {
      if (cancelled) {
        return;
      }
      setAvailability(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return availability;
}
