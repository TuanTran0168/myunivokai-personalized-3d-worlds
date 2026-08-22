"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { AdminApiError } from "@/lib/admin-http";
import { accountsApi } from "./api";
import type { AccountSummary } from "./types";

export function EditAccountDialog({
  account,
  open,
  onOpenChange
}: {
  account: AccountSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState(account.email);
  const [name, setName] = useState(account.name ?? "");
  const queryClient = useQueryClient();

  // Re-seed from the account's current values each time the dialog opens,
  // so a previous edit that was cancelled mid-typing doesn't linger.
  useEffect(() => {
    if (open) {
      setEmail(account.email);
      setName(account.name ?? "");
    }
  }, [open, account.email, account.name]);

  const updateMutation = useMutation({
    mutationFn: () => accountsApi.update(account.accountId, email, name),
    onSuccess: () => {
      toast.success("Account updated.");
      queryClient.invalidateQueries({ queryKey: ["accounts", account.accountId] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onOpenChange(false);
    },
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  const unchanged = email === account.email && name === (account.name ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>This account signs in with its email — changing it takes effect immediately.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateMutation.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-account-email">Email</Label>
            <Input id="edit-account-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-account-name">Name</Label>
            <Input id="edit-account-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending || unchanged}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
