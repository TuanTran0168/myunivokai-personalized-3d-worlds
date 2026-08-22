import { Badge } from "@/components/ui/badge";

// Pinned, read-only — represents accounts.is_super_admin, NOT a role row.
// notes/vision/auth-and-admin-plan.md#rbac is deliberate about this: a real
// role row can be edited or deleted like any other, which is exactly the
// "system becomes unadministerable" risk the bypass flag exists to prevent.
// This card exists so Roles still reads as "two system-level entries" without
// reversing that design — there is no edit/delete affordance because there is
// no row underneath it to act on.
export function SuperAdminCard() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          Super Admin <Badge variant="outline">system</Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          Every permission, always. A bypass flag on the account, not an assignable role — cannot be edited or deleted here.
        </p>
      </div>
    </div>
  );
}
