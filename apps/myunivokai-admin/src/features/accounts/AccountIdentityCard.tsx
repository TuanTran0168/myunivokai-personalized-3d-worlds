import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "./format";
import type { AccountSummary } from "./types";

// The account fields the list and detail queries already return but nobody
// rendered — the detail page used to show nothing but the role checkboxes.
export function AccountIdentityCard({ account }: { account: AccountSummary }) {
  return (
    <Card>
      <CardContent className="pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="capitalize">
            {account.kind === "staff" ? "Staff" : "End user"}
          </Badge>
          {account.isSuperAdmin ? <Badge variant="outline">Super admin</Badge> : null}
          {account.disabled ? (
            <Badge variant="destructive">Disabled</Badge>
          ) : account.forcePasswordChange ? (
            <Badge variant="secondary">Invited — awaiting first sign-in</Badge>
          ) : (
            <Badge>Active</Badge>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={account.name || "—"} />
          <Field label="Email" value={account.email} />
          <Field label="Roles" value={account.roles.length ? account.roles.join(", ") : "none"} />
          <Field label="Created" value={formatDateTime(account.createdAt)} />
          <Field label="Account id" value={account.accountId} mono />
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs text-foreground" : "text-sm text-foreground"}>{value}</dd>
    </div>
  );
}
