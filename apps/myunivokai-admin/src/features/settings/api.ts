import { adminRequest } from "@/lib/admin-http";
import type { SettingListResponse, SettingSummary } from "./types";

// The key is a path segment carrying dots, which need no encoding — a dot is
// an ordinary path character. It goes through encodeURIComponent anyway,
// because the value comes from a server response rather than from this file,
// and a key is not the place to rely on the server never having sent
// something unexpected.
export const settingsApi = {
  list: () => adminRequest<SettingListResponse>("/settings"),
  update: (settingKey: string, value: string) =>
    adminRequest<SettingSummary>(`/settings/${encodeURIComponent(settingKey)}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    })
};
