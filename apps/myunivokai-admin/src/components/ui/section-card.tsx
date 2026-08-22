import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Every panel on the analytics screens is a glass card with a small heading, an
// optional line of explanation, and sometimes a control on the right (a legend,
// a filter). Before this component there were two competing versions of that
// header in the same feature — an <h2 className="text-sm"> on the dashboard and
// an uppercase <p> on the fleet screen — which is the kind of drift nobody
// notices in review and everybody notices on the page.
export function SectionCard({
  title,
  description,
  action,
  className,
  contentClassName,
  children
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardContent className={cn("pt-2", contentClassName)}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
