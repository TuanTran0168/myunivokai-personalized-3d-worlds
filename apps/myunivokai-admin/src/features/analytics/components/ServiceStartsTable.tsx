import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { serviceDisplayName } from "@/lib/service-names";
import { formatDateTime, formatDuration } from "../format";
import type { ServiceStartRecord } from "../types";

export const SERVICE_START_HEADERS = ["Service", "Version", "Instance", "Boot time", "Started"];

export function ServiceStartsTable({ starts }: { starts: ServiceStartRecord[] }) {
  return (
    <>
      <div className="mt-3 hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              {SERVICE_START_HEADERS.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {starts.map((start) => (
              <TableRow key={`${start.instanceId}-${start.startedAt}`}>
                <TableCell className="text-sm font-medium">{serviceDisplayName(start.service)}</TableCell>
                <TableCell>
                  <ServiceVersion version={start.version} />
                </TableCell>
                <TableCell className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
                  {start.instanceId}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatDuration(start.bootDurationMs)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {formatDateTime(start.startedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex flex-col gap-3 lg:hidden">
        {starts.map((start) => (
          <ServiceStartCard key={`${start.instanceId}-${start.startedAt}`} start={start} />
        ))}
      </div>
    </>
  );
}

// "unknown" is a value a service really reports, not a gap in this table: it
// means nothing told the process which build it is — no SERVICE_VERSION, no
// host commit, and no Go VCS stamp, which a container image does not carry.
// It is dimmed and given a title rather than blanked, because blanking it
// would make a service that answered look like one that never did.
function ServiceVersion({ version }: { version: string }) {
  if (!version || version === "unknown") {
    return (
      <span
        className="font-mono text-xs text-muted-foreground/60"
        title="This process was not told which build it is running. Set SERVICE_VERSION, or run through `make local-up`, which stamps the working tree's own commit."
      >
        unknown
      </span>
    );
  }
  return <span className="font-mono text-xs text-muted-foreground">{version}</span>;
}

function ServiceStartCard({ start }: { start: ServiceStartRecord }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium">{serviceDisplayName(start.service)}</p>
        <Badge variant="ghost">
          <ServiceVersion version={start.version} />
        </Badge>
      </div>
      <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">{start.instanceId}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="ghost">boot {formatDuration(start.bootDurationMs)}</Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(start.startedAt)}</p>
    </div>
  );
}
