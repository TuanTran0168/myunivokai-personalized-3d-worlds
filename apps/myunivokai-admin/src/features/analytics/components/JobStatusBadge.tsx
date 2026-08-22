import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "../types";

// The status-to-colour mapping, in one file. It used to be exported from
// JobsPage and imported by the world detail page, which meant a page was
// acting as a component library for another page — the same reason
// FilterSelect moved out of DashboardPage.
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant = status === "failed" ? "destructive" : status === "completed" ? "outline" : "secondary";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}
