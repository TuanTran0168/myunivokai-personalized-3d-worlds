package repositories

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Opaque keyset-pagination cursor: encodes the (createdAt, id) of the last
// row a page ended on, ordered created_at DESC, id DESC (id breaks ties
// between equal timestamps). This is the first list/pagination endpoint in
// the repo — no existing convention to match — so it is documented here
// rather than invented silently; nature-service/universe-service/dna-service
// should converge on this same scheme when they add their own list queries.
var errMalformedCursor = errors.New("malformed cursor")

func encodeCursor(occurredAt time.Time, id string) string {
	raw := fmt.Sprintf("%d:%s", occurredAt.UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(cursor string) (occurredAt time.Time, id string, err error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", errMalformedCursor
	}
	nanosPart, idPart, found := strings.Cut(string(decoded), ":")
	if !found || idPart == "" {
		return time.Time{}, "", errMalformedCursor
	}
	nanos, err := strconv.ParseInt(nanosPart, 10, 64)
	if err != nil {
		return time.Time{}, "", errMalformedCursor
	}
	return time.Unix(0, nanos).UTC(), idPart, nil
}
