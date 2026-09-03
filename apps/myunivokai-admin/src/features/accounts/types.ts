import type { AccountKind, AccountSummary } from "@/lib/session";

export type { AccountKind, AccountSummary };

/**
 * The filter control's "no filter" value.
 *
 * A sentinel string rather than `undefined`, because the Base UI select needs
 * a real value for its trigger to have a label — and a select whose "any"
 * state renders as blank reads as broken rather than as unfiltered. `api.ts`
 * translates it back into an omitted query parameter.
 */
export const ALL_ACCOUNT_KINDS = "all";

export type AccountKindFilter = AccountKind | typeof ALL_ACCOUNT_KINDS;

/**
 * The filter's options, and the labels staff actually read.
 *
 * "End user" rather than "web" or "personalization": `kind` is a database
 * value and `aud=web` names a token's channel, neither of which is the thing a
 * staff member is looking for on this screen. The plan freezes both of those
 * names in the contracts precisely so the words shown to people can be chosen
 * separately — see its §17 and decision 20d.
 */
export const ACCOUNT_KIND_FILTER_OPTIONS: readonly { label: string; value: AccountKindFilter }[] = [
  { label: "All accounts", value: ALL_ACCOUNT_KINDS },
  { label: "Staff", value: "staff" },
  { label: "End users", value: "end_user" }
];

export function accountKindLabel(kind: AccountKind): string {
  return kind === "staff" ? "Staff" : "End user";
}
