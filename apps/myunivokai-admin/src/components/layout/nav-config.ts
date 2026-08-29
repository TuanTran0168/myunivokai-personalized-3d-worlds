import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Gauge,
  Globe2,
  LayoutDashboard,
  ListChecks,
  Palette,
  ScrollText,
  Server,
  ShieldAlert,
  Shield,
  Sparkles,
  Users
} from "lucide-react";
import { PERMISSIONS, type PermissionCode } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
  /** One line, shown as the link's title attribute — the sidebar has no room for it. */
  summary: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Three groups, by WHOSE QUESTION each screen answers — not by which service
// serves it, and not by which team built it.
//
//   Business       what the product is producing
//   Platform       what the platform is doing while producing it
//   Administration who is allowed to look
//
// This is DEFERRED-S5-NAV-001 in
// notes/plans/sprints/sprint-05-2026-08-13/user-stories.md, deferred until the
// sidebar demonstrably felt crowded rather than on the day the eighth entry
// landed. It does now, and the grouping that had been living in a comment here
// is the one that shipped.
//
// The service each screen reads from is deliberately NOT the axis. Traffic,
// Performance and Reliability all come from telemetry-service and are three
// entries because they answer three questions; Overview and Content mix both
// come from analytics-service for the same reason. Grouping by producer would
// put "how fast is the platform" next to "how many requests" only because one
// process happens to compute both.
//
// Every permission below also guards the gateway route behind it. The nav is a
// convenience; the gateway is the enforcement. Fleet and the three telemetry
// screens are gated on chartRead rather than codes of their own because the
// routes already are — inventing a code here would let the nav and the gateway
// disagree about who may see what.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Business",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: LayoutDashboard,
        permission: PERMISSIONS.chartRead,
        summary: "Headline numbers, how today compares to yesterday, and the generation funnel."
      },
      {
        href: "/worlds",
        label: "Worlds",
        icon: Globe2,
        permission: PERMISSIONS.worldRead,
        summary: "Every generated world, newest first."
      },
      {
        href: "/jobs",
        label: "Jobs",
        icon: ListChecks,
        permission: PERMISSIONS.jobRead,
        summary: "Every generation job and how it ended."
      },
      {
        href: "/content",
        label: "Content mix",
        icon: Palette,
        permission: PERMISSIONS.chartRead,
        summary: "What the generator is actually producing: archetypes, styles, moods, traits."
      },
      {
        href: "/rarity",
        label: "Rarity",
        icon: Sparkles,
        permission: PERMISSIONS.chartRead,
        summary: "How often each rare feature actually comes up, against the rate it was tuned to."
      }
    ]
  },
  {
    label: "Platform",
    items: [
      {
        href: "/telemetry",
        label: "Traffic",
        icon: Activity,
        permission: PERMISSIONS.chartRead,
        summary: "Request volume, the busiest hour, and which routes carry it."
      },
      {
        href: "/telemetry/performance",
        label: "Performance",
        icon: Gauge,
        permission: PERMISSIONS.chartRead,
        summary: "Where the time goes: p50 against p95, backend round trips, cache hit rates."
      },
      {
        href: "/telemetry/reliability",
        label: "Reliability",
        icon: ShieldAlert,
        permission: PERMISSIONS.chartRead,
        summary: "Errors, cold starts, and how much traffic survives the whole request path."
      },
      {
        href: "/fleet",
        label: "Fleet",
        icon: Server,
        permission: PERMISSIONS.chartRead,
        summary: "Which processes restarted, and which ones the gateway could not wake."
      }
    ]
  },
  {
    label: "Administration",
    items: [
      {
        href: "/accounts",
        label: "Accounts",
        icon: Users,
        permission: PERMISSIONS.accountRead,
        summary: "Staff accounts and the roles they hold."
      },
      {
        href: "/roles",
        label: "Roles",
        icon: Shield,
        permission: PERMISSIONS.roleRead,
        summary: "Roles and the permissions inside them."
      },
      {
        href: "/audit",
        label: "Audit log",
        icon: ScrollText,
        permission: PERMISSIONS.auditRead,
        summary: "Every administrative action, oldest retained first."
      }
    ]
  }
];

/** Flat view, for anything that needs to resolve a path rather than draw a menu. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
