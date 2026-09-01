"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { AdminApiError } from "@/lib/admin-http";
import { rolesApi } from "@/features/roles/api";
import { accountsApi } from "./api";
import type { AccountSummary } from "./types";

const GENERATED_PASSWORD_LENGTH = 16;
const GENERATED_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

// Random, not memorable — the password is handed off out of band right
// after creation (there is no email step to lose it in), so there is no
// reason to trade strength for something the admin has to type twice.
function generatePassword(): string {
  const bytes = new Uint32Array(GENERATED_PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => GENERATED_PASSWORD_ALPHABET[value % GENERATED_PASSWORD_ALPHABET.length]).join("");
}

async function copyToClipboard(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  toast.success(`${label} copied`);
}

// Direct account creation — no email infrastructure exists to relay an
// invite link, so the actor sets a password right now and the account is
// active immediately. See auth-service's
// agent-system/plans/services/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
export function CreateAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [created, setCreated] = useState<AccountSummary | null>(null);
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list, enabled: open });

  const createMutation = useMutation({
    mutationFn: () => accountsApi.create(email, name, password, selectedRoleIds),
    onSuccess: (account) => {
      setCreated(account);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setSelectedRoleIds([]);
    setCreated(null);
    createMutation.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create account</DialogTitle>
          <DialogDescription>
            {created
              ? "Share these credentials with the new staff member yourself — they are shown only once."
              : "The account is active as soon as it is created."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-muted p-2.5 font-mono text-xs break-all">
                  {created.email}
                </div>
                <Button type="button" variant="outline" size="icon-sm" onClick={() => copyToClipboard(created.email, "Email")}>
                  <Copy />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Password</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-muted p-2.5 font-mono text-xs break-all">{password}</div>
                <Button type="button" variant="outline" size="icon-sm" onClick={() => copyToClipboard(password, "Password")}>
                  <Copy />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-account-email">Email</Label>
              <Input
                id="create-account-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-account-name">Name</Label>
              <Input id="create-account-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
              <p className="text-xs text-muted-foreground">Optional. Shown next to the email in the accounts list.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-account-password">Password</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="create-account-password"
                  type="text"
                  required
                  minLength={12}
                  className="font-mono"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setPassword(generatePassword())}>
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">At least 12 characters. You choose it, or generate one.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Roles</Label>
              <div className="flex flex-col gap-2">
                {rolesQuery.data?.roles.map((role) => (
                  <label key={role.roleId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedRoleIds.includes(role.roleId)}
                      onCheckedChange={(checked) =>
                        setSelectedRoleIds((current) =>
                          checked ? [...current, role.roleId] : current.filter((id) => id !== role.roleId)
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
