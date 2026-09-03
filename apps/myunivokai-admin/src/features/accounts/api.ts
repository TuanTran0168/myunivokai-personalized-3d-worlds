import { adminRequest } from "@/lib/admin-http";
import { ALL_ACCOUNT_KINDS, type AccountKindFilter, type AccountSummary } from "./types";

export interface AccountListResponse {
  accounts: AccountSummary[];
  nextCursor?: string;
}

// buildQuery drops empty values rather than sending `?q=`: the gateway treats
// an empty string as "no filter" anyway, but omitting it keeps the React
// Query cache key and the request URL in agreement.
function buildQuery(parameters: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined || value === "") {
      continue;
    }
    query.set(name, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const accountsApi = {
  // search matches an account's email or name, case-insensitively. kind is
  // applied by auth-service, not here, and that matters: this list is
  // cursor-paginated, so filtering the received page would report "no end
  // users" whenever the newest twenty accounts happened to be staff. The
  // ALL_ACCOUNT_KINDS sentinel is dropped by buildQuery, so "any kind" sends
  // no parameter at all.
  list: (search?: string, kind?: AccountKindFilter, cursor?: string) =>
    adminRequest<AccountListResponse>(
      `/accounts${buildQuery({ q: search, kind: kind === ALL_ACCOUNT_KINDS ? "" : kind, cursor })}`
    ),
  get: (accountId: string) => adminRequest<AccountSummary>(`/accounts/${accountId}`),
  // Creates an account with a password set right now — active immediately,
  // with no invite token to relay. See auth-service's
  // agent-system/plans/services/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
  create: (email: string, name: string, password: string, roleIds: string[]) =>
    adminRequest<AccountSummary>("/accounts", {
      method: "POST",
      body: JSON.stringify({ email, name, password, roleIds })
    }),
  update: (accountId: string, email: string, name: string) =>
    adminRequest<AccountSummary>(`/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ email, name })
    }),
  disable: (accountId: string) => adminRequest<void>(`/accounts/${accountId}/disable`, { method: "POST" }),
  enable: (accountId: string) => adminRequest<void>(`/accounts/${accountId}/enable`, { method: "POST" })
};
