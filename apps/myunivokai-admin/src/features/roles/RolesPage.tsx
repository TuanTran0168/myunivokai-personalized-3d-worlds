"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { rolesApi } from "./api";
import type { RoleSummary } from "./types";
import { RoleFormDialog } from "./RoleFormDialog";
import { DeleteRoleDialog } from "./DeleteRoleDialog";
import { SuperAdminCard } from "./SuperAdminCard";

function RoleActions({
  role,
  onEdit,
  onDelete
}: {
  role: RoleSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (role.isSystem) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Role actions">
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RolesPage() {
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });
  const [formTarget, setFormTarget] = useState<{ open: boolean; role?: RoleSummary }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Composed freely from permissions. System roles can't be edited or deleted."
        sources={["Auth Service"]}
        action={
          <Button size="sm" onClick={() => setFormTarget({ open: true, role: undefined })}>
            <Plus />
            New role
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-2">
          <SuperAdminCard />
          {rolesQuery.isLoading ? (
            <TableSkeleton columnCount={3} headers={["Name", "Permissions", ""]} />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Permissions</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rolesQuery.data?.roles.map((role) => (
                      <TableRow key={role.roleId}>
                        <TableCell className="text-sm">
                          {role.name} {role.isSystem ? <Badge variant="outline">system</Badge> : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {role.permissions.map((codename) => (
                              <Badge key={codename} variant="secondary" className="font-mono text-[10px]">
                                {codename}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <RoleActions
                            role={role}
                            onEdit={() => setFormTarget({ open: true, role })}
                            onDelete={() => setDeleteTarget(role)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card layout */}
              <div className="flex flex-col gap-3 sm:hidden">
                {rolesQuery.data?.roles.map((role) => (
                  <div
                    key={role.roleId}
                    className="card-interactive flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {role.name} {role.isSystem ? <Badge variant="outline">system</Badge> : null}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {role.permissions.map((codename) => (
                          <Badge key={codename} variant="secondary" className="font-mono text-[10px]">
                            {codename}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <RoleActions
                      role={role}
                      onEdit={() => setFormTarget({ open: true, role })}
                      onDelete={() => setDeleteTarget(role)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <RoleFormDialog
        open={formTarget.open}
        role={formTarget.role}
        onOpenChange={(open) => setFormTarget((current) => ({ ...current, open }))}
      />
      {deleteTarget ? (
        <DeleteRoleDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)} role={deleteTarget} />
      ) : null}
    </div>
  );
}

