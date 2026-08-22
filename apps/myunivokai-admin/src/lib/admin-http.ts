import { fetchWithWakeRetry } from "./wake-retry";

// The one fetch wrapper every feature's api.ts calls through — genuinely
// cross-cutting (every /api/admin/* management call shares this error shape
// and base path), unlike the domain-specific calls that used to sit
// alongside it in a single admin-api.ts.
export class AdminApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // Every screen in this app goes through here, and on a scale-to-zero host
  // the services behind it are asleep more often than not — the console is
  // used a few times a day, not continuously. Without the wait, the first page
  // load after an idle period is a 503 for no reason a reader could act on.
  const response = await fetchWithWakeRetry(`/api/admin${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = payload.error ?? {};
    throw new AdminApiError(response.status, error.code || "REQUEST_FAILED", error.message || "The request failed.");
  }
  return payload as T;
}
