"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, PERMISSIONS, readAccountCookie } from "@/lib/session";
import { settingsApi } from "./api";
import { groupSettings, UNKNOWN_SETTINGS_GROUP_LABEL } from "./types";
import { OrphanSettingRow, SettingRow } from "./SettingRow";

const SETTINGS_SECTION_DESCRIPTIONS: Record<string, string> = {
  "quota.ai": "How many AI generations a caller gets a day. Over the limit a world is still produced, from presets — it is never refused.",
  "auth.token": "How long a session lasts, per audience. Revocation is immediate at any of these values, because the gateway rechecks it on every request.",
  "auth.lockout": "How many failed sign-ins lock an account, and for how long. Not session lengths."
};

// The platform's policy numbers, rendered FROM the registry the backend
// declares rather than from a form written here — which is what makes a new
// setting a backend-only change. A new key prefix becomes a new section on its
// own; a section with no sentence below just has no sentence.
export function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.list });
  // Read in an effect rather than during render, for the reason
  // (dashboard)/layout.tsx explains: reading cookies() on the server would
  // mark this whole route subtree dynamic and cost the prefetched loading
  // shell on every navigation.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    setCanManage(hasPermission(readAccountCookie(), PERMISSIONS.settingsManage));
  }, []);

  const groups = groupSettings(settingsQuery.data?.settings ?? []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Policy numbers an operator can change without a deploy. Every one takes effect on the next request."
        sources={["Auth Service"]}
      />

      <SectionCard
        title="How these behave"
        description="Worth knowing before changing one."
        contentClassName="pt-2"
      >
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>
              Each setting is an <strong className="font-medium text-foreground">override</strong>. Every one has a
              default compiled into the services, so a value that has never been changed here is not missing — the
              platform is running on the default shown beside the field.
            </span>
          </li>
          <li className="flex gap-2">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>
              The permitted range is declared in code and enforced by the server, not by this page. A value outside it
              is refused with the bound it broke.
            </span>
          </li>
          <li className="flex gap-2">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>
              Durations accept <span className="font-mono">30m</span>, <span className="font-mono">12h</span> and{" "}
              <span className="font-mono">7d</span>. Whole days only — <span className="font-mono">1.5d</span> is
              refused rather than rounded.
            </span>
          </li>
          <li className="flex gap-2">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>Every change is written to the audit log with the old value, the new value and who made it.</span>
          </li>
        </ul>
      </SectionCard>

      {!canManage ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-3 shrink-0" aria-hidden />
          <span>
            You can read these but not change them. Changing one needs the{" "}
            <span className="font-mono">settings:manage</span> permission.
          </span>
        </div>
      ) : null}

      {settingsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        groups.map((group) => (
          <SectionCard
            key={group.label}
            title={group.label}
            description={
              group.label === UNKNOWN_SETTINGS_GROUP_LABEL
                ? "Stored rows that code no longer declares."
                : SETTINGS_SECTION_DESCRIPTIONS[group.label]
            }
          >
            <div className="mt-2 flex flex-col">
              {group.settings.map((setting) =>
                setting.isDeclared ? (
                  <SettingRow key={setting.key} setting={setting} canManage={canManage} />
                ) : (
                  <OrphanSettingRow key={setting.key} setting={setting} />
                )
              )}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
}
