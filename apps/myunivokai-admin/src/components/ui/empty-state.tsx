import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Centered empty-state treatment: an icon, a title, and an optional
// description. Used for zero-result tables ("No events yet"), placeholder
// pages ("Coming in S4-ANALYTICS-007"), and any future zero-state screens.
//
// `children` is the slot for an action, added for the telemetry screen's "the
// charts live in Grafana" state: that one is not a dead end but a redirect,
// and a link belongs with the sentence explaining it rather than floating in
// the card above.
export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  children
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
