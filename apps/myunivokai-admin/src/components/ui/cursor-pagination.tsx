"use client";

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/features/analytics/types";

// Keyset pagination has no page numbers by construction: the server hands
// back a cursor for the NEXT page and nothing that would let a client jump to
// page 7. Going back is therefore the client's job — it keeps the cursors it
// has already used on a stack and pops one to return.
//
// That is the trade for a list that never gets slower as the table grows,
// which OFFSET pagination cannot promise.
export interface CursorPaginationState {
  cursor: string | undefined;
  pageSize: number;
  pageIndex: number;
  canGoBack: boolean;
  goNext: (nextCursor: string) => void;
  goBack: () => void;
  setPageSize: (pageSize: number) => void;
  reset: () => void;
}

export function useCursorPagination(initialPageSize: number = DEFAULT_PAGE_SIZE): CursorPaginationState {
  // history[i] is the cursor that produced page i. history[0] is always
  // undefined — the first page needs no cursor.
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageSize, setPageSizeValue] = useState(initialPageSize);

  const reset = useCallback(() => setHistory([undefined]), []);

  return {
    cursor: history[history.length - 1],
    pageSize,
    pageIndex: history.length - 1,
    canGoBack: history.length > 1,
    goNext: (nextCursor: string) => setHistory((current) => [...current, nextCursor]),
    goBack: () => setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    // Changing the page size invalidates every cursor already taken: a cursor
    // encodes a row position, and resuming from it under a different page
    // size would silently skip or repeat rows.
    setPageSize: (nextPageSize: number) => {
      setPageSizeValue(nextPageSize);
      reset();
    },
    reset
  };
}

export function CursorPagination({
  pagination,
  nextCursor,
  loadedCount,
  totalCount,
  isFetching
}: {
  pagination: CursorPaginationState;
  nextCursor?: string;
  loadedCount: number;
  totalCount: number;
  isFetching: boolean;
}) {
  const firstRow = totalCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const lastRow = pagination.pageIndex * pagination.pageSize + loadedCount;

  return (
    <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {firstRow}–{lastRow} of {totalCount.toLocaleString()}
        </span>
        <span aria-hidden className="text-border">
          |
        </span>
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            className="h-7 cursor-pointer rounded-md border border-border bg-transparent px-1.5 text-xs text-foreground outline-none focus-visible:border-ring"
            value={pagination.pageSize}
            onChange={(event) => pagination.setPageSize(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option} className="bg-popover text-popover-foreground">
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={pagination.goBack}
          disabled={!pagination.canGoBack || isFetching}
        >
          <ChevronLeft />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => nextCursor && pagination.goNext(nextCursor)}
          disabled={!nextCursor || isFetching}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
