import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The fallback a route segment shows while its payload is still on the wire.
//
// Every page here is a client component that already renders its own skeleton
// while React Query fetches — but that skeleton cannot appear until the route's
// own JavaScript and RSC payload have arrived, and until then the App Router
// keeps the *previous* page on screen. That is the stall: a click on a world
// looked like nothing had happened. A loading.tsx turns the segment into a
// Suspense boundary, so the navigation commits immediately and this stands in
// until the page itself takes over.
//
// One shape for every screen on purpose. A per-route silhouette would be a
// closer match for the half-second it is visible, at the cost of six files
// that have to be kept in step with six layouts.
export function PageSkeleton({ cardCount = 4 }: { cardCount?: number }) {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-8 w-48 rounded-lg" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cardCount }).map((_, index) => (
          <Skeleton key={index} className="h-[86px] rounded-2xl" />
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="pt-2">
          <Skeleton className="h-4 w-32 rounded-md" />
          <div className="mt-4 flex flex-col gap-2.5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-8 rounded-md" style={{ width: `${100 - index * 6}%` }} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
