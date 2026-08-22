// Presentation-only, like the analytics feature's own format.ts. Nothing here
// derives a figure; every number arriving was summed in SQL inside
// telemetry-service.

// Buckets are one minute wide, so a chart of the last 24 hours has 1440 of
// them. Showing a date on every tick is unreadable; the axis shows clock time
// and the tooltip shows the full instant.
export function formatBucketTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatBucketInstant(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// A status class is a leading digit on the wire. Spelling it out is what makes
// a legend readable without a key.
export function formatStatusClass(statusClass: number): string {
  const labels: Record<number, string> = {
    1: "1xx informational",
    2: "2xx success",
    3: "3xx redirect",
    4: "4xx client error",
    5: "5xx server error"
  };
  return labels[statusClass] ?? `${statusClass}xx`;
}

export function formatWindow(hours: number): string {
  if (hours < 24) {
    return `last ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `last ${days} day${days === 1 ? "" : "s"}`;
}
