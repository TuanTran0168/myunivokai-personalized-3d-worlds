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
import { rolesApi } from "./api";
import type { RoleSummary } from "./types";

export function DeleteRoleDialog({
  open,
  onOpenChange,
  role
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleSummary;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => rolesApi.remove(role.roleId),
    onSuccess: () => {
      toast.success(`${role.name} deleted.`);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      onOpenChange(false);
    },
    // ROLE_IN_USE carries the exact account count in its message (see
    // RoleInUseError on the auth-service side) — surfaced verbatim rather
    // than a generic failure toast.
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. A role still assigned to any account cannot be deleted — unassign it first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
