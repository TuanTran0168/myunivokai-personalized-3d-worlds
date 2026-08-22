"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/search-input";
import { accountsApi } from "./api";
import { CreateAccountDialog } from "./CreateAccountDialog";
import { AccountRowActions } from "./AccountRowActions";

export function AccountsPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts", search], queryFn: () => accountsApi.list(search) });

  const disableMutation = useMutation({
    mutationFn: accountsApi.disable,
    onSuccess: () => {
      toast.success("Account disabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
  const enableMutation = useMutation({
    mutationFn: accountsApi.enable,
    onSuccess: () => {
      toast.success("Account enabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Staff accounts, their roles and status."
        sources={["Auth Service"]}
        action={
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <UserPlus />
            Create account
          </Button>
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Email or name…" />
      </FilterBar>
      <Card>
        <CardContent className="pt-2">
          {accountsQuery.isLoading ? (
            <TableSkeleton columnCount={5} headers={["Name", "Email", "Roles", "Status", ""]} />
          ) : accountsQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{(accountsQuery.error as Error).message}</p>
          ) : (
            <>
              {/* Desktop table — hidden on mobile */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountsQuery.data?.accounts.map((account) => (
                      <TableRow key={account.accountId}>
                        <TableCell className="text-sm">{account.name || "—"}</TableCell>
                        <TableCell className="text-sm">{account.email}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {account.isSuperAdmin ? <Badge variant="outline">super admin</Badge> : null}
                            {account.roles.map((role) => (
                              <Badge key={role} variant="secondary">
                                {role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {account.disabled ? (
                            <Badge variant="destructive">disabled</Badge>
                          ) : account.forcePasswordChange ? (
                            <Badge variant="outline">invited</Badge>
                          ) : (
                            <Badge>active</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <AccountRowActions
                            account={account}
                            onDisable={() => disableMutation.mutate(account.accountId)}
                            onEnable={() => enableMutation.mutate(account.accountId)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card layout — visible only on small screens */}
              <div className="flex flex-col gap-3 sm:hidden">
                {accountsQuery.data?.accounts.map((account) => (
                  <div
                    key={account.accountId}
                    className="card-interactive flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.name || account.email}</p>
                      {account.name ? <p className="truncate text-xs text-muted-foreground">{account.email}</p> : null}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {account.isSuperAdmin ? <Badge variant="outline">super admin</Badge> : null}
                        {account.roles.map((role) => (
                          <Badge key={role} variant="secondary">
                            {role}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-1.5">
                        {account.disabled ? (
                          <Badge variant="destructive">disabled</Badge>
                        ) : account.forcePasswordChange ? (
                          <Badge variant="outline">invited</Badge>
                        ) : (
                          <Badge>active</Badge>
                        )}
                      </div>
                    </div>
                    <AccountRowActions
                      account={account}
                      onDisable={() => disableMutation.mutate(account.accountId)}
                      onEnable={() => enableMutation.mutate(account.accountId)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <CreateAccountDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
