package repositories

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (store *MemoryStore) RecordAuditEvent(_ context.Context, event AuditEvent) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	event.ID = uuid.NewString()
	event.OccurredAt = time.Now().UTC()
	store.auditEvents = append(store.auditEvents, event)
	return nil
}

// ListAuditEvents mirrors PostgresStore's occurred_at DESC, id DESC keyset
// order (cursor.go). Since/Until/Search are applied before the cursor walk,
// so TotalCount reflects the filtered set, not every event ever recorded.
func (store *MemoryStore) ListAuditEvents(_ context.Context, cursor string, pageSize int, since, until *time.Time, search string) ([]AuditEvent, string, int, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	needle := strings.ToLower(strings.TrimSpace(search))
	all := make([]AuditEvent, 0, len(store.auditEvents))
	for _, event := range store.auditEvents {
		if since != nil && event.OccurredAt.Before(*since) {
			continue
		}
		if until != nil && event.OccurredAt.After(*until) {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(event.Action), needle) && !strings.Contains(strings.ToLower(event.Target), needle) {
			continue
		}
		all = append(all, event)
	}
	sort.Slice(all, func(i, j int) bool {
		if !all[i].OccurredAt.Equal(all[j].OccurredAt) {
			return all[i].OccurredAt.After(all[j].OccurredAt)
		}
		return all[i].ID > all[j].ID
	})
	totalCount := len(all)

	startIndex := 0
	if cursor != "" {
		cursorTime, cursorID, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", 0, err
		}
		for index, event := range all {
			if event.OccurredAt.Before(cursorTime) || (event.OccurredAt.Equal(cursorTime) && event.ID < cursorID) {
				startIndex = index
				break
			}
			startIndex = index + 1
		}
	}

	remaining := all[startIndex:]
	var nextCursor string
	if len(remaining) > pageSize {
		last := remaining[pageSize-1]
		nextCursor = encodeCursor(last.OccurredAt, last.ID)
		remaining = remaining[:pageSize]
	}
	return remaining, nextCursor, totalCount, nil
}

// AuditEvents returns a snapshot of every recorded event, for tests that
// assert on audit behavior rather than only on returned errors.
func (store *MemoryStore) AuditEvents() []AuditEvent {
	store.mu.RLock()
	defer store.mu.RUnlock()
	events := make([]AuditEvent, len(store.auditEvents))
	copy(events, store.auditEvents)
	return events
}
