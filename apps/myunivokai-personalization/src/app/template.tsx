import type { ReactNode } from "react";

// A template re-mounts on every navigation (unlike layout), so wrapping the page
// here makes its content cross-fade in on each route change. The animation lives
// in .page-enter (globals.css) and is opacity-only on purpose: a transform/filter
// here would become a containing block for position:fixed descendants (the
// gallery's ambient 3D backdrop) and detach them from the viewport.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
