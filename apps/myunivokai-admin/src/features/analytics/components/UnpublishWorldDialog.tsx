"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { AdminApiError } from "@/lib/admin-http";
import { analyticsApi } from "../api";
import type { WorldFamily } from "../types";

// The gateway drops the share cache key immediately, using the slug the family
// service returns for exactly this purpose — so this is a ceiling, not an
// expectation. It is still stated on the screen, because "it is down" and "it
// is down within a minute" are different promises and staff acting on an abuse
// report deserve the second one rather than the first.
const SHARE_CACHE_CEILING_DESCRIPTION = "within about a minute";

export function UnpublishWorldDialog({
  open,
  onOpenChange,
  worldId,
  family,
  nickname
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId: string;
  family: WorldFamily;
  nickname: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => analyticsApi.unpublishWorld(family, worldId),
    onSuccess: (result) => {
      if (result.wasPublished) {
        toast.success(`${nickname}'s share page is down. The world itself is untouched.`);
      } else {
        // Not an error, and not a success worth celebrating either: somebody
        // else got there first, or this screen was stale.
        toast.info(`${nickname} was already unpublished. Nothing changed.`);
      }
      // The detail and every world list carry the published flag, so both are
      // stale the moment this succeeds. The overview's share-reach panel reads
      // telemetry rollups, which are minute buckets and are not invalidated by
      // anything a click can do.
      queryClient.invalidateQueries({ queryKey: ["analytics", "world", worldId] });
      queryClient.invalidateQueries({ queryKey: ["analytics", "worlds"] });
      onOpenChange(false);
    },
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take down {nickname}&rsquo;s share page?</AlertDialogTitle>
          <AlertDialogDescription>
            The public link stops working {SHARE_CACHE_CEILING_DESCRIPTION}. The world, its
            variants and its owner are untouched — this revokes the share slug and nothing else.
            <br />
            <br />
            Publishing again mints a <strong>new</strong> slug, so the old link stays dead. Every
            use of this action is recorded in the audit log against your account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Taking down…" : "Take it down"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
