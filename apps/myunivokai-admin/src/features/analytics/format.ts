// Shared formatting for the analytics screens. These are presentation-only:
// every number arriving here was already computed in SQL by
// analytics-service, and nothing in this file derives a new figure.

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

// Durations span three orders of magnitude in practice (a cached compose vs.
// a cold AI call), so a fixed unit reads badly at one end or the other.
export function formatDuration(milliseconds?: number | null): string {
  if (milliseconds === undefined || milliseconds === null) {
    return "—";
  }
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

export function formatDate(value?: string): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
