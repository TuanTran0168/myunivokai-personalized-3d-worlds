export interface AuditEventSummary {
  auditEventId: string;
  actorAccountId: string;
  action: string;
  target?: string;
  result: string;
  sourceAddress: string;
  occurredAt: string;
}

// Named AuditEventPage rather than AuditPage — the latter is already the
// page component's name in AuditPage.tsx, in the same feature folder.
export interface AuditEventPage {
  events: AuditEventSummary[];
  nextCursor?: string;
  totalCount: number;
}

// since/until are "YYYY-MM-DD" (native <input type="date"> values) or ""
// for no bound — the api layer converts them to RFC3339 instants. search
// matches an event's action or target, case-insensitively.
export interface AuditListFilters {
  since?: string;
  until?: string;
  search?: string;
}
