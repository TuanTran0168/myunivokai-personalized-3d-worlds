package repositories

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Opaque keyset-pagination cursor, the same scheme auth-service introduced in
// its own repositories/cursor.go and asked the other services to converge on:
// it encodes the (timestamp, id) of the last row a page ended on, ordered
// timestamp DESC, id DESC, with the id breaking ties between equal timestamps.
//
// Keyset, not OFFSET, on purpose. OFFSET makes page N cost N pages of scanning
// and eventually blows through the 2500ms request/reply deadline the moment
// the table grows; a keyset page costs the same whether it is the first or the
// thousandth, which is what makes the page-size cap a real bound.
func encodeCursor(occurredAt time.Time, id string) string {
	raw := fmt.Sprintf("%d:%s", occurredAt.UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(cursor string) (occurredAt time.Time, id string, err error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", ErrMalformedCursor
	}
	nanosPart, idPart, found := strings.Cut(string(decoded), ":")
	if !found || idPart == "" {
		return time.Time{}, "", ErrMalformedCursor
	}
	nanos, err := strconv.ParseInt(nanosPart, 10, 64)
	if err != nil {
		return time.Time{}, "", ErrMalformedCursor
	}
	return time.Unix(0, nanos).UTC(), idPart, nil
}
