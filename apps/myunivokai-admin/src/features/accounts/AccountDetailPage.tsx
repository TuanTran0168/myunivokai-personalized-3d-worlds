"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { AdminApiError } from "@/lib/admin-http";
import { rolesApi } from "@/features/roles/api";
import { accountsApi } from "./api";
import { AccountIdentityCard } from "./AccountIdentityCard";
import { EditAccountDialog } from "./EditAccountDialog";

export function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const accountQuery = useQuery({ queryKey: ["accounts", accountId], queryFn: () => accountsApi.get(accountId) });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.assign(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });
  const revokeMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.revoke(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  const account = accountQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={account?.name || account?.email || "…"}
        description="Account details and role assignment."
        sources={["Auth Service"]}
        action={
          account ? (
            <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
              <Pencil />
              Edit account
            </Button>
          ) : undefined
        }
      />
      {account ? <AccountIdentityCard account={account} /> : null}
      {account ? <EditAccountDialog account={account} open={isEditOpen} onOpenChange={setIsEditOpen} /> : null}
      <h2 className="text-sm font-medium text-muted-foreground">Roles</h2>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-2">
          {rolesQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="size-4 rounded" />
              </div>
            ))
          ) : (
            rolesQuery.data?.roles.map((role) => {
              const isAssigned = account?.roles.includes(role.name) ?? false;
              return (
                <label
                  key={role.roleId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors duration-150 hover:border-primary/30 hover:bg-accent/50"
                >
                  <div>
                    <p className="text-sm font-medium">{role.name}</p>
                    <p className="text-xs text-muted-foreground">{role.permissions.join(", ") || "no permissions"}</p>
                  </div>
                  <Checkbox
                    checked={isAssigned}
                    disabled={account?.isSuperAdmin}
                    onCheckedChange={(checked) => {
                      if (checked) assignMutation.mutate(role.roleId);
                      else revokeMutation.mutate(role.roleId);
                    }}
                  />
                </label>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

