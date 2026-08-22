package repositories

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (store *PostgresStore) RecordAuditEvent(ctx context.Context, event AuditEvent) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO audit_events (actor_account_id, action, target, result, source_address)
		VALUES ($1,$2,$3,$4,$5)`, event.ActorAccountID, event.Action, event.Target, event.Result, event.SourceAddress)
	return err
}

// ListAuditEvents orders occurred_at DESC, id DESC — same keyset scheme as
// ListAccounts (see cursor.go). Since/Until bound occurred_at the same way
// analytics-service's list queries bound their created_at columns. Search,
// when non-empty, matches action or target case-insensitively as a
// substring.
func (store *PostgresStore) ListAuditEvents(ctx context.Context, cursor string, pageSize int, since, until *time.Time, search string) ([]AuditEvent, string, int, error) {
	const selectColumns = `id::text, actor_account_id::text, action, target, result, source_address, occurred_at`

	conditions := []string{"TRUE"}
	arguments := []any{}
	if since != nil {
		arguments = append(arguments, *since)
		conditions = append(conditions, fmt.Sprintf("occurred_at >= $%d", len(arguments)))
	}
	if until != nil {
		arguments = append(arguments, *until)
		conditions = append(conditions, fmt.Sprintf("occurred_at <= $%d", len(arguments)))
	}
	if strings.TrimSpace(search) != "" {
		arguments = append(arguments, "%"+strings.TrimSpace(search)+"%")
		conditions = append(conditions, fmt.Sprintf("(action ILIKE $%d OR target ILIKE $%d)", len(arguments), len(arguments)))
	}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if cursor != "" {
		cursorTime, cursorID, decodeErr := decodeCursor(cursor)
		if decodeErr != nil {
			return nil, "", 0, decodeErr
		}
		pageArguments = append(pageArguments, cursorTime, cursorID)
		conditions = append(conditions, fmt.Sprintf("(occurred_at, id) < ($%d, $%d::uuid)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	var totalCount int
	if err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_events WHERE `+countCondition, arguments...).Scan(&totalCount); err != nil {
		return nil, "", 0, err
	}

	rows, err := store.pool.Query(ctx, `SELECT `+selectColumns+`
		FROM audit_events WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY occurred_at DESC, id DESC LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	if err != nil {
		return nil, "", 0, err
	}
	defer rows.Close()

	events := make([]AuditEvent, 0, pageSize)
	for rows.Next() {
		var event AuditEvent
		var actorAccountID, target *string
		if err := rows.Scan(&event.ID, &actorAccountID, &event.Action, &target, &event.Result, &event.SourceAddress, &event.OccurredAt); err != nil {
			return nil, "", 0, err
		}
		event.ActorAccountID = actorAccountID
		if target != nil {
			event.Target = *target
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, "", 0, err
	}

	var nextCursor string
	if len(events) > pageSize {
		last := events[pageSize-1]
		nextCursor = encodeCursor(last.OccurredAt, last.ID)
		events = events[:pageSize]
	}
	return events, nextCursor, totalCount, nil
}
