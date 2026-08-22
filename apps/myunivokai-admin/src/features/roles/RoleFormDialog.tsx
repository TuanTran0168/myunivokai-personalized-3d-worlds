"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminApiError } from "@/lib/admin-http";
import { rolesApi } from "./api";
import type { RoleSummary } from "./types";

// A single dialog handles both create and edit: RoleUpdateData has no name
// field (a role's name is immutable after creation, per contracts/go), so
// editing only ever changes description/permissions — the same shape as
// half of create.
export function RoleFormDialog({
  open,
  onOpenChange,
  role
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: RoleSummary;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selectedCodenames, setSelectedCodenames] = useState<string[]>(role?.permissions ?? []);
  const queryClient = useQueryClient();
  const permissionsQuery = useQuery({ queryKey: ["permissions"], queryFn: rolesApi.listPermissions, enabled: open });

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDescription(role?.description ?? "");
      setSelectedCodenames(role?.permissions ?? []);
    }
  }, [open, role]);

  const mutation = useMutation({
    mutationFn: () =>
      role
        ? rolesApi.update(role.roleId, { description, permissions: selectedCodenames })
        : rolesApi.create({ name, description, audience: "admin", permissions: selectedCodenames }),
    onSuccess: () => {
      toast.success(role ? "Role updated." : "Role created.");
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      onOpenChange(false);
    },
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>Roles compose freely from the permissions below.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" required disabled={Boolean(role)} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Permissions</Label>
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {permissionsQuery.data?.permissions.map((permission) => (
                <label key={permission.codename} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedCodenames.includes(permission.codename)}
                    onCheckedChange={(checked) =>
                      setSelectedCodenames((current) =>
                        checked ? [...current, permission.codename] : current.filter((codename) => codename !== permission.codename)
                      )
                    }
                  />
                  <span className="font-mono text-xs">{permission.codename}</span>
                  <span className="text-xs text-muted-foreground">{permission.description}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : role ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
