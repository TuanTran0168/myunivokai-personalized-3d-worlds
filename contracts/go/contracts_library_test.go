package contracts

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

const libraryTestOwnerAccountID = "11111111-1111-1111-1111-111111111111"

// Section 12's response-model guarantee, asserted as a property of the TYPE
// rather than of one handler's output.
//
// A test over a sample response would pass while a new field sat unset in it.
// This one fails the moment a field is declared, which is the point at which
// somebody should have to argue for it: this response leaves the service that
// owns the personal data, so a field added here is a field that has to be
// taken back out of a public JSON shape later.
func TestTheWorldListRowCarriesNothingSensitive(t *testing.T) {
	summaryType := reflect.TypeOf(LibraryWorldSummary{})
	allowedFields := map[string]struct{}{"WorldID": {}, "Family": {}, "CreatedAt": {}}
	if summaryType.NumField() != len(allowedFields) {
		t.Fatalf("LibraryWorldSummary has %d fields; section 8 declares %d. A field here leaves dna-service on every page of somebody's gallery",
			summaryType.NumField(), len(allowedFields))
	}
	for fieldIndex := 0; fieldIndex < summaryType.NumField(); fieldIndex++ {
		fieldName := summaryType.Field(fieldIndex).Name
		if _, allowed := allowedFields[fieldName]; !allowed {
			t.Errorf("LibraryWorldSummary.%s is not one of the three fields section 8 declares. No DNA, no raw input, no email, no nickname: argue it in the plan's response model before adding it here", fieldName)
		}
	}
}

// The same rule one level out, because the page wrapper is also a public
// shape: two fields, the rows and the cursor.
func TestTheWorldListPageCarriesOnlyRowsAndACursor(t *testing.T) {
	pageType := reflect.TypeOf(LibraryListResponseData{})
	const expectedFieldCount = 2
	if pageType.NumField() != expectedFieldCount {
		t.Fatalf("LibraryListResponseData has %d fields, expected %d (worlds, nextCursor)", pageType.NumField(), expectedFieldCount)
	}
}

func TestTheWorldListQueryRefusesARequestThatWouldReturnEverybodysWorlds(t *testing.T) {
	testCases := []struct {
		description string
		query       LibraryListQueryData
	}{
		{description: "no owner at all", query: LibraryListQueryData{}},
		{description: "a blank owner", query: LibraryListQueryData{OwnerAccountID: "   "}},
		{description: "an owner that is not a UUID", query: LibraryListQueryData{OwnerAccountID: "everybody"}},
	}
	for _, testCase := range testCases {
		if err := testCase.query.Validate(); err == nil {
			t.Errorf("a query with %s was accepted. Without an owner this returns either everybody's worlds or nobody's, and one of those is a data leak", testCase.description)
		}
	}
}

// A limit is CLAMPED and a cursor is REFUSED, and the asymmetry is the
// decision: "give me 500" has an honest answer, which is a page of 50 and a
// cursor, while a cursor that did not come from a real row has none - it would
// silently return a page from the wrong place in the list.
func TestAnOversizedLimitIsClampedRatherThanRefused(t *testing.T) {
	query := LibraryListQueryData{OwnerAccountID: libraryTestOwnerAccountID, Limit: 500}
	if err := query.Validate(); err != nil {
		t.Fatalf("an oversized limit was refused rather than clamped: %v", err)
	}
	if query.PageSize() != MaximumLibraryPageSize {
		t.Fatalf("page size = %d, want the maximum %d", query.PageSize(), MaximumLibraryPageSize)
	}
}

func TestAnUnnamedLimitBecomesTheDefaultPageSize(t *testing.T) {
	for _, namedLimit := range []int{0, -1} {
		query := LibraryListQueryData{OwnerAccountID: libraryTestOwnerAccountID, Limit: namedLimit}
		if query.PageSize() != DefaultLibraryPageSize {
			t.Fatalf("limit %d gave page size %d, want the default %d", namedLimit, query.PageSize(), DefaultLibraryPageSize)
		}
	}
}

// The page size cannot exceed what the web app can then hydrate. The gallery
// loads each page's cards through `GET /api/{family}/worlds?ids=`, which
// refuses more than 50 identifiers, so a larger page would list worlds the app
// is unable to load.
func TestTheMaximumPageSizeFitsTheBatchThatHydratesIt(t *testing.T) {
	const maximumBatchWorldIdentifiers = 50
	if MaximumLibraryPageSize > maximumBatchWorldIdentifiers {
		t.Fatalf("a page of %d worlds cannot be hydrated by a batch of %d. The gallery would list worlds it can never load",
			MaximumLibraryPageSize, maximumBatchWorldIdentifiers)
	}
}

func TestALibraryCursorSurvivesARoundTrip(t *testing.T) {
	createdAt := time.Date(2026, 9, 3, 14, 30, 15, 123456789, time.UTC)
	const jobID = "01K4ABCDEFGHJKMNPQRSTVWXYZ"

	decodedCreatedAt, decodedJobID, err := DecodeLibraryCursor(EncodeLibraryCursor(createdAt, jobID))
	if err != nil {
		t.Fatalf("decode a cursor this package encoded: %v", err)
	}
	if !decodedCreatedAt.Equal(createdAt) {
		t.Fatalf("created at = %s, want %s", decodedCreatedAt, createdAt)
	}
	if decodedJobID != jobID {
		t.Fatalf("job id = %q, want %q", decodedJobID, jobID)
	}
}

// The job id is in the cursor to break a timestamp tie, so it has to survive
// one. Two jobs CAN share a created_at: a retry writes its row with the same
// statement's clock.
func TestTwoCursorsAtTheSameInstantStayDistinct(t *testing.T) {
	sharedInstant := time.Date(2026, 9, 3, 14, 30, 15, 0, time.UTC)
	firstCursor := EncodeLibraryCursor(sharedInstant, "01JOBAAA")
	secondCursor := EncodeLibraryCursor(sharedInstant, "01JOBBBB")
	if firstCursor == secondCursor {
		t.Fatal("two jobs sharing a created_at produced the same cursor, so a page boundary between them would repeat or skip a world")
	}
}

func TestAnUnreadableCursorIsRefusedRatherThanIgnored(t *testing.T) {
	unreadableCursors := []string{"not base64 at all!!", "", "###"}
	for _, cursor := range unreadableCursors {
		if _, _, err := DecodeLibraryCursor(cursor); err == nil {
			t.Errorf("the cursor %q was accepted; an invented cursor would return a page from the wrong place in the list", cursor)
		}
	}
	// A cursor with no job id half is unreadable for the same reason: the tie
	// break would be missing and the page boundary unstable.
	halfACursor := EncodeLibraryCursor(time.Now(), "")
	if _, _, err := DecodeLibraryCursor(halfACursor); !errors.Is(err, ErrInvalidLibraryCursor) {
		t.Fatalf("a cursor with no job id gave %v, want ErrInvalidLibraryCursor", err)
	}
}

func TestAQueryCarryingAnUnreadableCursorFailsValidation(t *testing.T) {
	query := LibraryListQueryData{OwnerAccountID: libraryTestOwnerAccountID, Cursor: "not a cursor"}
	if err := query.Validate(); !errors.Is(err, ErrInvalidLibraryCursor) {
		t.Fatalf("validate gave %v, want ErrInvalidLibraryCursor", err)
	}
}

// A cursor is opaque so that nobody constructs one. Base64 is what makes that
// true in practice - a reader who can see a timestamp in it will eventually
// build one, and the keyset's correctness depends on it having come from a
// real row.
func TestACursorDoesNotLookLikeDataSomebodyWouldEdit(t *testing.T) {
	cursor := EncodeLibraryCursor(time.Date(2026, 9, 3, 14, 30, 0, 0, time.UTC), "01JOBAAA")
	if strings.Contains(cursor, ":") || strings.Contains(cursor, "01JOBAAA") {
		t.Fatalf("the cursor %q exposes its own fields", cursor)
	}
}

// The subject has to be a query rather than a command: somebody is looking at
// a gallery waiting for the answer, and a JetStream command answers nobody.
// Also a `queries.` subject is admitted by the ACL wildcard that already
// exists, so this needs no NATS config change.
func TestTheWorldListSubjectIsAQuery(t *testing.T) {
	if !strings.HasPrefix(DNALibraryListQuerySubject, "myunivokai.queries.") {
		t.Fatalf("subject %q is not on the query surface", DNALibraryListQuerySubject)
	}
	if !strings.HasSuffix(DNALibraryListQuerySubject, ".v1") {
		t.Fatalf("subject %q is not versioned", DNALibraryListQuerySubject)
	}
}
