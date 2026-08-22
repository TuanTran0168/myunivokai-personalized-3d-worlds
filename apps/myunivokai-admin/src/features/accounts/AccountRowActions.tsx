"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { AccountSummary } from "./types";

export function AccountRowActions({
  account,
  onDisable,
  onEnable
}: {
  account: AccountSummary;
  onDisable: () => void;
  onEnable: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Account actions">
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/accounts/${account.accountId}`}>Manage roles</Link>} />
        {account.disabled ? (
          <DropdownMenuItem onClick={onEnable}>Enable account</DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onClick={onDisable}>
            Disable account
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
