export interface RoleSummary {
  roleId: string;
  name: string;
  description?: string;
  audience: "admin" | "web";
  isSystem: boolean;
  permissions: string[];
}

export interface PermissionSummary {
  codename: string;
  description: string;
  audience: "admin" | "web";
}
