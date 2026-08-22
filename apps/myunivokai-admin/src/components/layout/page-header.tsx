"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Title + description + primary action, rendered as plain text OUTSIDE any
// card — the Linear/Stripe pattern. v1 stuffed this into a CardHeader, which
// is why every screen read as "one big card" instead of a page.
//
// `action` is for an ACTION — a "Create account" button. Filters belong in
// FilterBar on the row below: when they lived here, the header's height
// depended on how many filters a screen had, so no two screens had the same
// title position and the app read as several apps.
//
// `sources` names which backend service(s) actually computed what the screen
// is about to show — already-resolved display names (see
// @/lib/service-names), never a raw key like "analytics-service". This
// answers a question every screen otherwise leaves implicit: an operator
// staring at an empty chart needs to know whether to go check telemetry-service
// or auth-service, and the nav grouping deliberately does not carry that
// information (see nav-config.ts's own comment on why the service is not the
// grouping axis).
export function PageHeader({
  title,
  description,
  action,
  sources
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  sources?: string[];
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <motion.p
            className="mt-1 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.05, ease: "easeOut" }}
          >
            {description}
          </motion.p>
        ) : null}
        {sources && sources.length > 0 ? (
          <motion.div
            className="mt-2 flex flex-wrap items-center gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.1, ease: "easeOut" }}
          >
            <Database className="size-3 text-muted-foreground/70" aria-hidden />
            <span className="text-xs text-muted-foreground">Data from</span>
            {sources.map((source) => (
              <Badge key={source} variant="outline">
                {source}
              </Badge>
            ))}
          </motion.div>
        ) : null}
      </motion.div>
      {action}
    </div>
  );
}

