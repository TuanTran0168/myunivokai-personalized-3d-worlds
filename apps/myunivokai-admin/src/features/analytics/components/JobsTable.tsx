import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JobStatusBadge } from "./JobStatusBadge";
import { formatDateTime, formatDuration } from "../format";
import type { JobProjection } from "../types";

// showFamily rather than a second component: the jobs screen lists jobs from
// every family and the world detail page lists the jobs of one world, whose
// family is already stated at the top of that page. Before this, the two were
// separate tables with different column orders and different headings for the
// same field ("Started"/"Created"), which made the same data look like two
// different things depending on how you arrived at it.
export function jobTableHeaders(showFamily: boolean): string[] {
  return [
    "Job",
    ...(showFamily ? ["Family"] : []),
    "Status",
    "Duration",
    "Error",
    "Started",
    "Finished"
  ];
}

export function JobsTable({ jobs, showFamily = true }: { jobs: JobProjection[]; showFamily?: boolean }) {
  const headers = jobTableHeaders(showFamily);
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.jobId}>
                <TableCell className="font-mono text-xs">{job.jobId}</TableCell>
                {showFamily ? (
                  <TableCell>
                    {job.family ? (
                      <Badge variant="outline" className="capitalize">
                        {job.family}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <JobStatusBadge status={job.status} />
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{formatDuration(job.durationMs)}</TableCell>
                <TableCell className="max-w-[18rem]">
                  {job.errorCode ? (
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-destructive">{job.errorCode}</p>
                      {job.errorMessage ? (
                        <p className="truncate text-xs text-muted-foreground">{job.errorMessage}</p>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {formatDateTime(job.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {formatDateTime(job.completedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {jobs.map((job) => (
          <JobCard key={job.jobId} job={job} showFamily={showFamily} />
        ))}
      </div>
    </>
  );
}

function JobCard({ job, showFamily }: { job: JobProjection; showFamily: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs">{job.jobId}</p>
        <JobStatusBadge status={job.status} />
      </div>
      {job.errorCode ? (
        <p className="mt-1.5 font-mono text-xs text-destructive">
          {job.errorCode}
          {job.errorMessage ? <span className="ml-1 text-muted-foreground">{job.errorMessage}</span> : null}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {showFamily && job.family ? (
          <Badge variant="outline" className="capitalize">
            {job.family}
          </Badge>
        ) : null}
        <Badge variant="ghost">{formatDuration(job.durationMs)}</Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</p>
    </div>
  );
}
