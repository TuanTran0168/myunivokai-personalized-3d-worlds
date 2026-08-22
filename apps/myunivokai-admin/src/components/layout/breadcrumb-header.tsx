"use client";

import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/components/layout/nav-config";

// The current page's location in the sticky header, resolved from the pathname
// against nav-config. On mobile the sidebar is hidden entirely, so this is the
// only thing saying where you are.
//
// It prints the group as well as the page now that the sidebar has groups.
// "Performance" alone is ambiguous once the platform screens and the business
// screens both exist; "Platform / Performance" is not, and it teaches the
// grouping to anyone who arrived by link rather than by clicking.
export function BreadcrumbHeader() {
  const pathname = usePathname();
  const match = resolve(pathname);
  if (!match) return null;

  return (
    <>
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <span className="hidden text-sm text-muted-foreground sm:inline">{match.group}</span>
      <span className="hidden text-sm text-muted-foreground sm:inline" aria-hidden="true">
        /
      </span>
      <span className="text-sm font-medium text-foreground">{match.label}</span>
    </>
  );
}

function resolve(pathname: string): { group: string; label: string } | null {
  const candidates = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ group: group.label, label: item.label, href: item.href }))
  );

  const exact = candidates.find((candidate) => candidate.href === pathname);
  if (exact) return exact;

  // Longest prefix wins. "/telemetry" is a real page AND the parent of
  // "/telemetry/performance", so a first-match-wins scan over declaration
  // order would label the child with its parent's name.
  const prefixed = candidates
    .filter((candidate) => candidate.href !== "/" && pathname.startsWith(`${candidate.href}/`))
    .sort((left, right) => right.href.length - left.href.length);
  return prefixed[0] ?? null;
}
