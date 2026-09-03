"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminApiError } from "@/lib/admin-http";
import { settingsApi } from "./api";
import {
  settingBoundsHint,
  settingInputKind,
  settingLeafLabel,
  type SettingSummary
} from "./types";

const BOOLEAN_TRUE = "true";
const BOOLEAN_FALSE = "false";

function formatChangedAt(timestamp: string): string {
  const changedAt = new Date(timestamp);
  if (Number.isNaN(changedAt.getTime())) return timestamp;
  return changedAt.toLocaleString();
}

// One declared setting: what it is, what it is worth, and the one control that
// changes it.
//
// The whole row is rendered FROM the server's description of the setting —
// type, bounds, vocabulary, description — rather than from anything written
// here. That is the property the dotted registry was for: a tenth setting
// appears on this screen with no frontend change at all, in its own section if
// its prefix is new.
export function SettingRow({
  setting,
  canManage
}: {
  setting: SettingSummary;
  canManage: boolean;
}) {
  const [draftValue, setDraftValue] = useState(setting.value);
  const queryClient = useQueryClient();

  // A refetch that brings a different value must win over an untouched draft —
  // otherwise a change made in another tab is invisible here. It deliberately
  // does not guard on dirtiness: this screen is used by one operator at a
  // time, and a stale field that looks editable is worse than a lost keystroke.
  useEffect(() => {
    setDraftValue(setting.value);
  }, [setting.value]);

  const mutation = useMutation({
    mutationFn: (value: string) => settingsApi.update(setting.key, value),
    onSuccess: (updated) => {
      toast.success(`${setting.key} is now ${updated.value}.`);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    // The gateway validates against the same Go registry that declares the
    // bounds, so its message names the bound that was broken. Showing it
    // verbatim is the point: an operator told "must be between 1m and 24h"
    // fixes their own mistake.
    onError: (error: AdminApiError) => {
      toast.error(error.message);
      setDraftValue(setting.value);
    }
  });

  const inputKind = settingInputKind(setting);
  const boundsHint = settingBoundsHint(setting);
  const hasUnsavedChange = draftValue !== setting.value;
  const inputIdentifier = `setting-${setting.key}`;

  function save(value: string) {
    mutation.mutate(value);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {settingLeafLabel(setting.key)}
          {setting.isOverridden ? <Badge variant="secondary">changed</Badge> : null}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{setting.key}</p>
        {setting.description ? (
          <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground/80">
          {boundsHint ? <span>{boundsHint}</span> : null}
          {setting.defaultValue ? <span>Default {setting.defaultValue}</span> : null}
          {setting.isOverridden && setting.updatedAt ? (
            <span>
              Changed {formatChangedAt(setting.updatedAt)}
              {setting.updatedByAccountId ? ` by ${setting.updatedByAccountId}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {inputKind === "boolean" ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id={inputIdentifier}
              checked={draftValue === BOOLEAN_TRUE}
              disabled={!canManage || mutation.isPending}
              onCheckedChange={(checked) => {
                const value = checked ? BOOLEAN_TRUE : BOOLEAN_FALSE;
                setDraftValue(value);
                // A toggle has no separate Save: the click IS the decision,
                // and a checkbox that needs confirming reads as broken.
                save(value);
              }}
            />
            {draftValue === BOOLEAN_TRUE ? "On" : "Off"}
          </label>
        ) : null}

        {inputKind === "choice" ? (
          <Select
            value={draftValue}
            disabled={!canManage || mutation.isPending}
            onValueChange={(value) => {
              // The primitive's value is nullable — it clears to null when
              // the selection is dismissed — and a setting has no null. An
              // empty string would be refused by the server's own validation,
              // so the cleared case keeps the current value instead.
              const chosen = value ?? setting.value;
              setDraftValue(chosen);
              save(chosen);
            }}
          >
            <SelectTrigger id={inputIdentifier} className="w-44">
              <SelectValue>{(currentValue: string) => currentValue}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(setting.allowedValues ?? []).map((allowed) => (
                <SelectItem key={allowed} value={allowed}>
                  {allowed}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {inputKind === "number" || inputKind === "text" ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (hasUnsavedChange) save(draftValue);
            }}
          >
            <Input
              id={inputIdentifier}
              // `inputMode` rather than `type="number"`, deliberately. A
              // number input strips a value it cannot parse, so a mistyped
              // duration would vanish instead of being answered with the
              // bound it broke — and the server is the thing that validates.
              inputMode={inputKind === "number" ? "numeric" : "text"}
              className="w-32 font-mono text-sm"
              value={draftValue}
              disabled={!canManage || mutation.isPending}
              onChange={(event) => setDraftValue(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!canManage || !hasUnsavedChange || mutation.isPending}>
              Save
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

// An orphan: a row whose key has left the Go registry. It has no type, no
// bounds and no default, so there is nothing to validate a new value against
// and no control is offered.
//
// It is shown rather than hidden, and left in the database rather than
// deleted, because it holds a number somebody chose — see §9.3. The copy says
// what to do about it, since "unknown setting" on its own reads as a bug in
// this screen.
export function OrphanSettingRow({ setting }: { setting: SettingSummary }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        {setting.key}
        <Badge variant="outline">not declared</Badge>
      </p>
      <p className="text-xs text-muted-foreground">
        This row is stored but no longer declared in code, so nothing reads it and its value cannot be
        validated. It is kept rather than deleted on purpose — removing a value somebody chose should be a
        deliberate act, not a side effect of a deploy.
      </p>
      <p className="font-mono text-[11px] text-muted-foreground/80">
        {setting.value}
        {setting.updatedAt ? ` · last changed ${formatChangedAt(setting.updatedAt)}` : ""}
      </p>
    </div>
  );
}
