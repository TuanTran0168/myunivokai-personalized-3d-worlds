import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "../format";
import type { WorldProjection } from "../types";

export const WORLD_TABLE_HEADERS = [
  "Nickname",
  "Family",
  "Archetype",
  "Scene",
  "Style",
  "Mood",
  "Variants",
  "Published",
  "Created"
];

// One component owns both renderings of the worlds list. They are not two
// views to keep in step by hand — nine columns do not fit a phone, and a
// horizontally scrolling table hides exactly the columns that matter — but
// they are one concept, and splitting them across two files is how a column
// gets added to the table and forgotten on the card.
export function WorldsTable({ worlds }: { worlds: WorldProjection[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              {WORLD_TABLE_HEADERS.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {worlds.map((world) => (
              <TableRow key={world.worldId}>
                <TableCell className="text-sm font-medium">
                  <Link
                    href={`/worlds/${world.worldId}`}
                    className="rounded-sm underline-offset-4 transition-colors duration-150 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {world.nickname}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {world.family}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{world.archetype}</TableCell>
                <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                  {world.sceneName}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{world.worldStyle}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{world.mood}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {world.selectedVariantNo}/{world.variantCount}
                </TableCell>
                <TableCell>
                  {world.isPublished ? (
                    <Badge variant="default">Public</Badge>
                  ) : (
                    <Badge variant="secondary">Private</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {formatDateTime(world.worldCreatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {worlds.map((world) => (
          <WorldCard key={world.worldId} world={world} />
        ))}
      </div>
    </>
  );
}

function WorldCard({ world }: { world: WorldProjection }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/worlds/${world.worldId}`} className="block truncate text-sm font-medium hover:text-primary">
            {world.nickname}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{world.archetype}</p>
        </div>
        {world.isPublished ? <Badge variant="default">Public</Badge> : <Badge variant="secondary">Private</Badge>}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{world.sceneName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="capitalize">
          {world.family}
        </Badge>
        <Badge variant="ghost">{world.worldStyle}</Badge>
        <Badge variant="ghost">{world.mood}</Badge>
        <Badge variant="ghost">
          {world.selectedVariantNo}/{world.variantCount} variants
        </Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(world.worldCreatedAt)}</p>
    </div>
  );
}
