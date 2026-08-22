import { adminRequest } from "@/lib/admin-http";
import type { PermissionSummary, RoleSummary } from "./types";

export const rolesApi = {
  list: () => adminRequest<{ roles: RoleSummary[] }>("/roles"),
  create: (input: { name: string; description: string; audience: "admin" | "web"; permissions: string[] }) =>
    adminRequest<RoleSummary>("/roles", { method: "POST", body: JSON.stringify(input) }),
  update: (roleId: string, input: { description: string; permissions: string[] }) =>
    adminRequest<RoleSummary>(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (roleId: string) => adminRequest<void>(`/roles/${roleId}`, { method: "DELETE" }),
  assign: (accountId: string, roleId: string) =>
    adminRequest<void>("/roles/assign", { method: "POST", body: JSON.stringify({ accountId, roleId }) }),
  revoke: (accountId: string, roleId: string) =>
    adminRequest<void>("/roles/revoke", { method: "POST", body: JSON.stringify({ accountId, roleId }) }),
  listPermissions: () => adminRequest<{ permissions: PermissionSummary[] }>("/permissions")
};
