package repositories

import (
	"context"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The account's own world list. One keyset page, one statement, and no new
// table: `generation_jobs` already links a profile to a world and a family,
// which is section 3.1's whole argument against a `library-service`.
//
// **What this query cannot do, stated because a story asked for it.**
// `S8-IDENTITY-015`'s last task says to exclude worlds the owning family has
// flagged deleted. This service cannot see that: the flag lives in the FAMILY
// service's own database, and by Phase B correction 6 a deletion emits no
// event, so nothing here is ever told a world is gone. The filter's one home
// is the family service's own read, where it already is - the web app hydrates
// every card through `GET /api/{family}/worlds?ids=`, and a deleted world is
// simply absent from that response. A page of 25 can therefore render 24
// cards, which the gallery already handles: a batch response has always been
// allowed to return fewer worlds than were asked for.
//
// **And what it costs, stated because the story's source evidence overstates
// it.** Section 8 cites `analytics-service`'s index comment about every page
// costing the same as the first. That property does not carry over, because
// here the FILTER is on `profiles.owner_account_id` and the ORDER is on
// `generation_jobs.created_at` - two tables, so no single index serves both
// and Postgres sorts the account's matching jobs to find a page boundary. What
// the story actually asked for is satisfied: this is keyset and never OFFSET,
// so a page boundary is stable and a world created mid-paging cannot shift a
// row onto a page already seen. The sort is affordable because one create
// makes one profile (decision 6), so the row count is the account's own world
// count. It would stop being affordable somewhere in the thousands per
// account, and the fix then is to denormalise `owner_account_id` onto
// `generation_jobs` - which is a second home for ownership, and therefore a
// decision rather than an optimisation.

const listOwnedWorldsStatement = `SELECT j.world_id::text, j.family, j.created_at, j.job_id
	FROM generation_jobs j
	JOIN profiles p ON p.id = j.profile_id
	WHERE p.owner_account_id = $1
	  AND j.world_id IS NOT NULL
	ORDER BY j.created_at DESC, j.job_id DESC
	LIMIT $2`

// The same statement with the cursor predicate. Two statements rather than one
// with a nullable cursor, because `(j.created_at, j.job_id) < (NULL, NULL)` is
// NULL and returns no rows at all - a first page that silently comes back
// empty, which is the shape of bug that looks like "the account has no
// worlds".
//
// The comparison is a ROW VALUE, not two ANDed comparisons. `created_at < $2
// AND job_id < $3` would drop every row that shares the cursor's timestamp and
// sorts after its job id, which is exactly the tie the job id is in the cursor
// to break.
const listOwnedWorldsAfterCursorStatement = `SELECT j.world_id::text, j.family, j.created_at, j.job_id
	FROM generation_jobs j
	JOIN profiles p ON p.id = j.profile_id
	WHERE p.owner_account_id = $1
	  AND j.world_id IS NOT NULL
	  AND (j.created_at, j.job_id) < ($3, $4)
	ORDER BY j.created_at DESC, j.job_id DESC
	LIMIT $2`

// ListOwnedWorlds returns one page of the worlds one account owns, newest
// first, plus the cursor for the next page.
//
// It asks for ONE ROW MORE than the page size and then trims, which is how the
// last page is recognised without a second query: an extra row means there is
// more, no extra row means this is the end. A COUNT over the same predicate
// would double the cost of every page to answer a question the rows already
// answer.
//
// The predicate is `owner_account_id = $1` and never `anonymous_id`. An
// anonymous visitor's list is their browser's `localStorage`, which is what
// they had before accounts existed and what they still have: there is no
// server-side list for somebody who cannot prove who they are, which is the
// same reasoning decision 16 uses to leave a pre-plan world unclaimable.
func (store *PostgresStore) ListOwnedWorlds(ctx context.Context, query contracts.LibraryListQueryData) (contracts.LibraryListResponseData, error) {
	if err := query.Validate(); err != nil {
		return contracts.LibraryListResponseData{}, err
	}
	pageSize := query.PageSize()
	rows, err := store.queryOwnedWorlds(ctx, query, pageSize+1)
	if err != nil {
		return contracts.LibraryListResponseData{}, err
	}
	page := contracts.LibraryListResponseData{Worlds: make([]contracts.LibraryWorldSummary, 0, pageSize)}
	for rowIndex, row := range rows {
		if rowIndex == pageSize {
			break
		}
		page.Worlds = append(page.Worlds, row.summary)
	}
	if len(rows) > pageSize {
		// Built from the LAST RETURNED row, not from the extra one, so the
		// next page starts exactly where this one stopped.
		lastReturnedRow := rows[pageSize-1]
		page.NextCursor = contracts.EncodeLibraryCursor(lastReturnedRow.createdAt, lastReturnedRow.jobID)
	}
	return page, nil
}

// ownedWorldRow is one row plus the two values the cursor is built from.
//
// The job id and the raw creation time are not part of the response model -
// the cursor carries them opaquely - so the wire shape stays the three fields
// section 8 declares and a caller cannot start depending on a job id it was
// never promised.
type ownedWorldRow struct {
	summary   contracts.LibraryWorldSummary
	jobID     string
	createdAt time.Time
}

func (store *PostgresStore) queryOwnedWorlds(ctx context.Context, query contracts.LibraryListQueryData, rowLimit int) ([]ownedWorldRow, error) {
	statement := listOwnedWorldsStatement
	arguments := []any{query.OwnerAccountID, rowLimit}
	if query.Cursor != "" {
		cursorCreatedAt, cursorJobID, err := contracts.DecodeLibraryCursor(query.Cursor)
		if err != nil {
			return nil, err
		}
		statement = listOwnedWorldsAfterCursorStatement
		arguments = append(arguments, cursorCreatedAt, cursorJobID)
	}
	resultRows, err := store.pool.Query(ctx, statement, arguments...)
	if err != nil {
		return nil, err
	}
	defer resultRows.Close()
	rows := make([]ownedWorldRow, 0, rowLimit)
	for resultRows.Next() {
		var row ownedWorldRow
		if err := resultRows.Scan(&row.summary.WorldID, &row.summary.Family, &row.createdAt, &row.jobID); err != nil {
			return nil, err
		}
		row.summary.CreatedAt = row.createdAt.UTC()
		rows = append(rows, row)
	}
	return rows, resultRows.Err()
}
