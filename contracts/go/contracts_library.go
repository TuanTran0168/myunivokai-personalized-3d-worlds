package contracts

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The account's own world list: one keyset page of worlds one account owns.
//
// Design: section 8 and section 3.1 of
// agent-system/plans/architecture/end-user-identity-and-ownership.md. §3.1 is
// the one to read first, because it is the argument for why this is a query
// against `dna-service` rather than a `library-service`: `generation_jobs`
// already links profile to world to family, so a new service would own a copy
// of a link that already exists.

// DNALibraryListQuerySubject answers "which worlds does this account own".
//
// A QUERY on the NATS Core request/reply surface, not a JetStream command:
// somebody is looking at a gallery waiting for the answer. It needs no ACL
// change - the config grants the gateway `myunivokai.queries.>` and
// dna-service the same, so a new query subject is admitted by the rule that
// already exists rather than by a line added for it.
const DNALibraryListQuerySubject = "myunivokai.queries.dna.library.list.v1"

// MaximumLibraryPageSize is the largest page this query will answer, and it is
// not an arbitrary round number: the web app hydrates each page's cards with
// `GET /api/{family}/worlds?ids=`, which refuses more than 50 identifiers. A
// page bigger than that batch would return worlds the app cannot then load.
const MaximumLibraryPageSize = 50

// DefaultLibraryPageSize is what a caller that names no size gets. It matches
// the `limit=25` in section 8's own URL.
const DefaultLibraryPageSize = 25

// LibraryWorldSummary is one row of the list, and it is deliberately three
// fields.
//
// **No DNA, no raw input, no email, no nickname.** The same response-model
// guarantee the share endpoint has, for the same reason: this response leaves
// the service that owns the personal data, and a field added here is a field
// that has to be removed from a public JSON shape later. The web app needs
// exactly enough to ask the family service for the card - which world, on
// which backend - and the creation time it already sorts by.
type LibraryWorldSummary struct {
	WorldID   string      `json:"worldId"`
	Family    WorldFamily `json:"family"`
	CreatedAt time.Time   `json:"createdAt"`
}

// LibraryListQueryData is one page request.
//
// Cursor is opaque to the caller and is the previous page's NextCursor. It
// encodes the last row's creation time and job id, which is what makes the
// paging KEYSET rather than OFFSET: every page costs the same as the first,
// and a world created while somebody is paging cannot shift a row onto a page
// they have already seen.
type LibraryListQueryData struct {
	OwnerAccountID string `json:"ownerAccountId"`
	Cursor         string `json:"cursor,omitempty"`
	Limit          int    `json:"limit,omitempty"`
}

// LibraryListResponseData is one page.
//
// NextCursor is empty on the last page. It is empty rather than absent-with-a
// -flag because "no more rows" and "no cursor" are the same fact, and a
// separate boolean would be a second thing to keep true.
type LibraryListResponseData struct {
	Worlds     []LibraryWorldSummary `json:"worlds"`
	NextCursor string                `json:"nextCursor,omitempty"`
}

var ErrInvalidLibraryCursor = errors.New("that page cursor is not readable")

const (
	// The cursor is base64 of "<unix nanoseconds>:<job id>". Base64 so that a
	// caller is not tempted to read it, construct one, or depend on its shape:
	// the moment a cursor looks like data, somebody builds one, and the
	// keyset's correctness depends on it having come from a real row.
	libraryCursorFieldSeparator = ":"
	libraryCursorFieldCount     = 2
)

// Validate refuses a request that cannot produce a correct page.
//
// An owner account id is required and is not defaulted: this query returns one
// account's worlds, and a missing owner would either return everybody's or
// nobody's. Both are wrong, and one of them is a data leak.
//
// A limit outside its range is CLAMPED rather than refused, which is the
// opposite of how the settings registry treats an out-of-range value. The
// difference is who typed it: a settings value is an operator's decision and
// silently changing it would lie to them, while a page size is a client's
// request for a convenience and the honest answer to "give me 500" is 50 rows.
func (data LibraryListQueryData) Validate() error {
	if strings.TrimSpace(data.OwnerAccountID) == "" {
		return errors.New("ownerAccountId is required")
	}
	if !IsUUID(strings.TrimSpace(data.OwnerAccountID)) {
		return errors.New("ownerAccountId must be a UUID")
	}
	if data.Cursor != "" {
		if _, _, err := DecodeLibraryCursor(data.Cursor); err != nil {
			return err
		}
	}
	return nil
}

// PageSize is the limit this request should actually be served with, clamped
// into range. Zero and negative both mean "the caller named none".
func (data LibraryListQueryData) PageSize() int {
	if data.Limit <= 0 {
		return DefaultLibraryPageSize
	}
	if data.Limit > MaximumLibraryPageSize {
		return MaximumLibraryPageSize
	}
	return data.Limit
}

// EncodeLibraryCursor turns the last row of a page into the cursor for the
// next one.
//
// The job id is in there as well as the timestamp, and it is not redundant:
// two jobs can share a `created_at` to the microsecond, because a retry writes
// its row with the same statement's clock. With the timestamp alone, a page
// boundary landing between two such rows either repeats one or skips one, and
// which of the two depends on the sort's tie-break - so the tie-break is part
// of the cursor.
func EncodeLibraryCursor(createdAt time.Time, jobID string) string {
	raw := strconv.FormatInt(createdAt.UTC().UnixNano(), 10) + libraryCursorFieldSeparator + jobID
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeLibraryCursor reads one back. Every failure is the same answer -
// ErrInvalidLibraryCursor - because a caller cannot act differently on a
// cursor that was truncated than on one that was invented.
func DecodeLibraryCursor(cursor string) (time.Time, string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(cursor))
	if err != nil {
		return time.Time{}, "", fmt.Errorf("%w: %v", ErrInvalidLibraryCursor, err)
	}
	fields := strings.SplitN(string(decoded), libraryCursorFieldSeparator, libraryCursorFieldCount)
	if len(fields) != libraryCursorFieldCount || fields[1] == "" {
		return time.Time{}, "", ErrInvalidLibraryCursor
	}
	nanoseconds, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("%w: %v", ErrInvalidLibraryCursor, err)
	}
	return time.Unix(0, nanoseconds).UTC(), fields[1], nil
}
