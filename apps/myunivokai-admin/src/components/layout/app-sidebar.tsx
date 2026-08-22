"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { motion } from "motion/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/components/layout/nav-config";
import { BrandMark } from "@/components/layout/brand-mark";
import { hasPermission, readAccountCookie } from "@/lib/session";
import { useLogout } from "@/hooks/use-logout";
import { useSessionKeepAlive } from "@/hooks/use-session-keepalive";

function AccountAvatar({ email }: { email: string }) {
  const initial = email.charAt(0).toUpperCase();
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

// Reads the account itself from the (non-httpOnly) account cookie rather
// than receiving it as a prop from a server-rendered layout. The layout used
// to do that with cookies(), but reading cookies() there marked the entire
// dashboard route subtree dynamic, which defeated Link's static prefetch of
// each route's loading.tsx — every navigation then waited on a live server
// round trip before even the loading skeleton could appear. Deferring this
// to a client effect means the very first render has no account (same as
// what the server would have rendered anyway), and it fills in a moment
// later — imperceptible next to the network round trip it replaces.
export function AppSidebar() {
  const pathname = usePathname();
  const [account, setAccount] = useState<ReturnType<typeof readAccountCookie>>(null);
  useEffect(() => {
    setAccount(readAccountCookie());
  }, []);
  // A group with nothing visible in it is dropped entirely rather than
  // rendered as a heading over empty space — a reader with no chart permission
  // should not be told that a "Platform" section exists and is off limits.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(account, item.permission))
  })).filter((group) => group.items.length > 0);
  const logout = useLogout();
  const { isMobile, setOpenMobile } = useSidebar();
  useSessionKeepAlive();

  // On mobile the sidebar is a Sheet overlay (see ui/sidebar.tsx) sitting on
  // top of the page it navigates to — closing it here is standard behavior
  // for that pattern (every other Sheet-based nav closes itself on select).
  // Desktop's persistent column has no such overlay to dismiss, so it's a
  // no-op there.
  function handleNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <BrandMark className="h-5 w-5 shrink-0" />
          <span className="font-heading text-base font-semibold text-sidebar-foreground">Myunivokai</span>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-primary">
            Admin
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  // Exact match, not startsWith. "/telemetry" is the parent of
                  // "/telemetry/performance", and a prefix test would light two
                  // entries at once — which the shared layoutId below then
                  // animates between on every render.
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        className="relative overflow-hidden data-[active=true]:bg-transparent"
                        render={
                          <Link href={item.href} onClick={handleNavigate} title={item.summary}>
                            {isActive ? (
                              <motion.span
                                layoutId="nav-active-pill"
                                className="absolute inset-0 rounded-md bg-primary/15"
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                              />
                            ) : null}
                            <item.icon className="relative z-10" />
                            <span className="relative z-10">{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        {account ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <AccountAvatar email={account.email} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{account.email}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Log out"
            >
              <LogOut />
            </Button>
          </div>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}

