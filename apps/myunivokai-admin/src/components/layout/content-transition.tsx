"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

// Scoped to the content pane ONLY (see (dashboard)/layout.tsx) — the sidebar
// and header are siblings, outside this component, and never remount on
// navigation. Opacity + a tiny y-shift (6px, not 16px — the original was
// rejected as "wobbly"). Dashboards like Linear/Vercel don't move their
// chrome on every click, but a small y-translate on the content pane reads
// as a natural page settling into place.
//
// The exit is deliberately far shorter than the entrance. `mode="wait"` holds
// the incoming page back until the outgoing one has finished leaving, so an
// exit of the same 180ms was adding most of a fifth of a second to every click
// on top of the route's own load — read as the page "sticking" before it moved.
// A near-instant fade out keeps the sequencing (no two pages overlapping in a
// non-positioned container) without spending time on the frame nobody looks at.
export function ContentTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.06, ease: "linear" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

