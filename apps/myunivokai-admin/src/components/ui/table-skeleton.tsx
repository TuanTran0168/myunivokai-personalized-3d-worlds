import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

// Shimmer skeleton rows for data tables. Renders a realistic placeholder
// while queries are in flight — column count and row count are configurable.
// Header labels are optional (pass them to match the real table).
export function TableSkeleton({
  columnCount,
  rowCount = 5,
  headers
}: {
  columnCount: number;
  rowCount?: number;
  headers?: string[];
}) {
  return (
    <Table>
      {headers ? (
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
      ) : null}
      <TableBody>
        {Array.from({ length: rowCount }).map((_, rowIndex) => (
          <TableRow key={rowIndex}>
            {Array.from({ length: columnCount }).map((_, colIndex) => (
              <TableCell key={colIndex}>
                <Skeleton
                  className="h-4"
                  style={{
                    width: `${60 + Math.floor(((rowIndex * 7 + colIndex * 13) % 30))}%`
                  }}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
