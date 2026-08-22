package repositories

import (
	"encoding/base64"
	"errors"
	"testing"
	"time"
)

func TestCursorRoundTripsTheKeysetPosition(t *testing.T) {
	position := time.Date(2026, 8, 7, 12, 34, 56, 789_000_000, time.UTC)
	cursor := encodeCursor(position, "018f2a1e-0000-7000-8000-000000000001")
	decodedPosition, decodedID, err := decodeCursor(cursor)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if !decodedPosition.Equal(position) {
		t.Fatalf("decoded position = %s, want %s", decodedPosition, position)
	}
	if decodedID != "018f2a1e-0000-7000-8000-000000000001" {
		t.Fatalf("decoded id = %q", decodedID)
	}
}

// A corrupt cursor must be an error, not a silent restart from page one:
// restarting would re-show rows the caller has already paged past and read as
// a data bug rather than a bad cursor.
func TestMalformedCursorsAreRejected(t *testing.T) {
	malformedCursors := []string{"not base64!!", "", "AAAA", encodeCursorRaw("abc:id"), encodeCursorRaw("123")}
	for _, cursor := range malformedCursors {
		if _, _, err := decodeCursor(cursor); !errors.Is(err, ErrMalformedCursor) {
			t.Fatalf("decodeCursor(%q) error = %v, want ErrMalformedCursor", cursor, err)
		}
	}
}

func encodeCursorRaw(raw string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}
