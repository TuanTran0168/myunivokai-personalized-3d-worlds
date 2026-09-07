"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, EyeOff, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { AdminApiError } from "@/lib/admin-http";
import { hasPermission, PERMISSIONS, readAccountCookie } from "@/lib/session";
import { analyticsApi } from "./api";
import { ColorSwatches } from "./components/ColorSwatches";
import { JobsTable } from "./components/JobsTable";
import { TraitBars } from "./components/TraitBars";
import { UnpublishWorldDialog } from "./components/UnpublishWorldDialog";
import { WorldIdentityCard } from "./components/WorldIdentityCard";

export function WorldDetailPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = use(params);
  const worldQuery = useQuery({
    queryKey: ["analytics", "world", worldId],
    queryFn: () => analyticsApi.world(worldId),
    // A 404 here is a stale link or a world the projection has not caught up
    // to. Neither is fixed by asking again three more times.
    retry: (failureCount, error) =>
      !(error instanceof AdminApiError && error.status === 404) && failureCount < 2
  });

  // Read in an effect rather than during render, for the reason
  // (dashboard)/layout.tsx explains: reading cookies() on the server would mark
  // this route subtree dynamic and cost the prefetched loading shell on every
  // navigation. Same pattern as SettingsPage.
  const [canUnpublish, setCanUnpublish] = useState(false);
  useEffect(() => {
    setCanUnpublish(hasPermission(readAccountCookie(), PERMISSIONS.worldUnpublish));
  }, []);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);

  const detail = worldQuery.data;
  const world = detail?.world;
  const notFound = worldQuery.error instanceof AdminApiError && worldQuery.error.status === 404;

  return (
    <div>
      <PageHeader
        title={world?.nickname ?? (worldQuery.isLoading ? "…" : "World")}
        description={world ? `${world.archetype} · ${world.sceneName}` : undefined}
        sources={["Analytics Service"]}
        action={
          <div className="flex items-center gap-2">
            {canUnpublish && world?.isPublished ? (
              <button
                type="button"
                onClick={() => setUnpublishDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive transition-colors duration-150 hover:border-destructive hover:bg-destructive/10"
              >
                <EyeOff className="size-4" />
                Take down share page
              </button>
            ) : null}
            <Link
              href="/worlds"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:border-primary/30 hover:bg-accent/50 hover:text-foreground"
          >
              <ArrowLeft className="size-4" />
              All worlds
            </Link>
          </div>
        }
      />

      {world && canUnpublish ? (
        <UnpublishWorldDialog
          open={unpublishDialogOpen}
          onOpenChange={setUnpublishDialogOpen}
          worldId={world.worldId}
          family={world.family}
          nickname={world.nickname}
        />
      ) : null}

      {notFound ? (
        <EmptyState
          icon={AlertTriangle}
          title="No such world in the read model"
          description="Either the id is wrong, or the world was created moments ago and the projection has not caught up yet. Analytics is eventually consistent by design."
        />
      ) : worldQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="This world is unavailable"
          description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
        />
      ) : worldQuery.isLoading || !world || !detail ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <WorldIdentityCard world={world} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard title="Trait scores" contentClassName="pb-1">
              <div className="mt-3">
                <TraitBars scores={world.traitScores} />
              </div>
            </SectionCard>

            <SectionCard title="Favorite colors">
              <ColorSwatches colors={world.favoriteColors} />
            </SectionCard>
          </div>

          <Card>
            <CardContent className="pt-2">
              <p className="text-sm font-medium text-foreground">Job history · {detail.jobs.length}</p>
              {detail.jobs.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="No jobs recorded against this world"
                  description="A world projected from an event that predates job tracking has no history here."
                />
              ) : (
                <div className="mt-3">
                  {/* showFamily is off because this page already states the
                      family at the top; the column would repeat one value
                      down every row. */}
                  <JobsTable jobs={detail.jobs} showFamily={false} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
