import { PageSkeleton } from "@/components/ui/page-skeleton";

// Placed on the group segment rather than on each route, because a loading.tsx
// covers its own segment and every segment nested under it. One file therefore
// gives the whole dashboard an instant navigation; a route that ever needs a
// different silhouette can add its own beside its page.tsx and it will win.
export default function DashboardLoading() {
  return <PageSkeleton />;
}
