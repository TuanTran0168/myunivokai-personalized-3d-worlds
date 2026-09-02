"use client";

import { useEffect, useState } from "react";
import { SweepRail } from "@/components/SweepRail";

const STATUS_MESSAGE_ROTATION_INTERVAL_MILLISECONDS = 2200;

const GENERATION_STATUS_MESSAGES = [
  "Reading your portrait...",
  "Resolving your Personality DNA...",
  "Seeding your world...",
  "Placing your worlds...",
  "Curating the final view..."
];

type GeneratingOverlayProps = {
  isVisible: boolean;
  status?: "queued" | "processing";
};

/**
 * Full-screen transition shown while the backend calls the AI provider and
 * builds the world. Pure CSS animation so it stays smooth during the request.
 */
export function GeneratingOverlay({ isVisible, status }: GeneratingOverlayProps) {
  const [statusMessageIndex, setStatusMessageIndex] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setStatusMessageIndex(0);
      return;
    }
    const rotationInterval = setInterval(() => {
      setStatusMessageIndex((currentIndex) => (currentIndex + 1) % GENERATION_STATUS_MESSAGES.length);
    }, STATUS_MESSAGE_ROTATION_INTERVAL_MILLISECONDS);
    return () => clearInterval(rotationInterval);
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-surface-lowest/90 backdrop-blur-md">
      <div className="flex flex-col items-center gap-8 px-6 text-center">
        <div className="relative h-36 w-36">
          <div className="absolute inset-0 animate-[spin_6s_linear_infinite] rounded-full border border-brass/30" />
          <div className="absolute inset-3 animate-[spin_4s_linear_infinite_reverse] rounded-full border border-brass/15" />
          <div className="absolute inset-0 animate-[spin_6s_linear_infinite]">
            <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-brass shadow-[0_0_10px_rgba(201,163,91,0.6)]" />
          </div>
          <div className="absolute inset-3 animate-[spin_4s_linear_infinite_reverse]">
            <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-vermillion shadow-[0_0_8px_rgba(224,87,58,0.7)]" />
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <span className="h-10 w-10 animate-pulse rounded-full bg-brass shadow-[0_0_24px_rgba(201,163,91,0.5)]" />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-center gap-2 text-brass">
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Curating your world</span>
          </div>
          <p className="min-h-7 text-lg font-semibold text-on-surface" aria-live="polite">
            {status === "queued" ? "Your request is safely queued..." : GENERATION_STATUS_MESSAGES[statusMessageIndex]}
          </p>
          {/* The rings above turn, which says the app is alive; they do not say
              anything is going anywhere. This is the longest wait in the
              product, so it gets the one element that reads as travel. */}
          <div className="mx-auto mt-1 w-48">
            <SweepRail />
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">This usually takes a few seconds.</p>
        </div>
      </div>
    </div>
  );
}
