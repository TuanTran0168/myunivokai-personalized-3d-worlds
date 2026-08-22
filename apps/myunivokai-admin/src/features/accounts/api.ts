import { adminRequest } from "@/lib/admin-http";
import type { AccountSummary } from "./types";

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
  // search matches an account's email or name, case-insensitively.
  list: (search?: string, cursor?: string) =>
    adminRequest<AccountListResponse>(`/accounts${buildQuery({ q: search, cursor })}`),
  get: (accountId: string) => adminRequest<AccountSummary>(`/accounts/${accountId}`),
  // Creates an account with a password set right now — active immediately,
  // with no invite token to relay. See auth-service's
  // notes/vision/auth-and-admin-plan.md#account-creation-is-direct-not-invited.
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
