package handlers

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/nats-io/nats.go"
)

const libraryQueryTestOwnerAccountID = "11111111-1111-1111-1111-111111111111"

var errStoreUnavailable = errors.New("connection refused reading generation_jobs")

type recordingResponsePublisher struct {
	publishedPayloads [][]byte
}

func (publisher *recordingResponsePublisher) Publish(_ string, payload []byte) error {
	publisher.publishedPayloads = append(publisher.publishedPayloads, payload)
	return nil
}

func libraryQueryMessage(t *testing.T, query contracts.LibraryListQueryData, replySubject string) *nats.Msg {
	t.Helper()
	payload, err := json.Marshal(contracts.NewEnvelope("01QUERY", query))
	if err != nil {
		t.Fatalf("encode the query: %v", err)
	}
	return &nats.Msg{Subject: contracts.DNALibraryListQuerySubject, Reply: replySubject, Data: payload}
}

func decodeRPCResponse(t *testing.T, payload []byte) contracts.RPCResponseData {
	t.Helper()
	var envelope contracts.Envelope[contracts.RPCResponseData]
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode the response: %v", err)
	}
	return envelope.Data
}

func TestTheWorldListQueryRelaysTheOwnerItWasGiven(t *testing.T) {
	service := &generationServiceSpy{listedPage: contracts.LibraryListResponseData{
		Worlds: []contracts.LibraryWorldSummary{{
			WorldID: "d290f1ee-6c54-4b01-90e6-d701748f0851", Family: contracts.WorldFamilyUniverse, CreatedAt: time.Now().UTC(),
		}},
	}}
	publisher := &recordingResponsePublisher{}
	handler := NewNATSHandler(service, publisher, time.Second)

	handler.HandleLibraryListQuery(libraryQueryMessage(t,
		contracts.LibraryListQueryData{OwnerAccountID: libraryQueryTestOwnerAccountID, Limit: 10}, "reply.subject"))

	if len(service.listedQueries) != 1 {
		t.Fatalf("the service was asked %d times, want once", len(service.listedQueries))
	}
	if service.listedQueries[0].OwnerAccountID != libraryQueryTestOwnerAccountID {
		t.Fatalf("owner = %q, want %q", service.listedQueries[0].OwnerAccountID, libraryQueryTestOwnerAccountID)
	}
	if len(publisher.publishedPayloads) != 1 {
		t.Fatalf("%d responses published, want 1", len(publisher.publishedPayloads))
	}
	if statusCode := decodeRPCResponse(t, publisher.publishedPayloads[0]).StatusCode; statusCode != 200 {
		t.Fatalf("status = %d, want 200", statusCode)
	}
}

// A query with no owner must never reach the store. Without an owner the
// statement would return either everybody's worlds or none, and this is the
// layer that can still say so as a 400 rather than as an empty gallery.
func TestTheWorldListQueryRefusesAMessageWithNoOwner(t *testing.T) {
	service := &generationServiceSpy{}
	publisher := &recordingResponsePublisher{}
	handler := NewNATSHandler(service, publisher, time.Second)

	handler.HandleLibraryListQuery(libraryQueryMessage(t, contracts.LibraryListQueryData{}, "reply.subject"))

	if len(service.listedQueries) != 0 {
		t.Fatalf("a query with no owner reached the store: %+v", service.listedQueries)
	}
	if len(publisher.publishedPayloads) != 1 {
		t.Fatalf("%d responses published, want 1", len(publisher.publishedPayloads))
	}
	response := decodeRPCResponse(t, publisher.publishedPayloads[0])
	if response.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
}

// An unreadable cursor is a 400 and not an empty page, because the two look
// identical to a visitor and only one of them is their gallery being broken.
func TestTheWorldListQueryRefusesAnUnreadableCursor(t *testing.T) {
	service := &generationServiceSpy{}
	publisher := &recordingResponsePublisher{}
	handler := NewNATSHandler(service, publisher, time.Second)

	handler.HandleLibraryListQuery(libraryQueryMessage(t, contracts.LibraryListQueryData{
		OwnerAccountID: libraryQueryTestOwnerAccountID, Cursor: "not a cursor at all",
	}, "reply.subject"))

	if len(service.listedQueries) != 0 {
		t.Fatalf("a query with an unreadable cursor reached the store: %+v", service.listedQueries)
	}
	if statusCode := decodeRPCResponse(t, publisher.publishedPayloads[0]).StatusCode; statusCode != 400 {
		t.Fatalf("status = %d, want 400", statusCode)
	}
}

// A query with no reply subject is answered by doing nothing. It is not a
// request at all - somebody published onto the query surface - and replying to
// an empty subject is an error in every log for a message nobody is waiting
// on. Same rule as HandleJobQuery.
func TestTheWorldListQueryIgnoresAMessageWithNowhereToReply(t *testing.T) {
	service := &generationServiceSpy{}
	publisher := &recordingResponsePublisher{}
	handler := NewNATSHandler(service, publisher, time.Second)

	handler.HandleLibraryListQuery(libraryQueryMessage(t,
		contracts.LibraryListQueryData{OwnerAccountID: libraryQueryTestOwnerAccountID}, ""))

	if len(publisher.publishedPayloads) != 0 {
		t.Fatalf("%d responses published for a message with no reply subject", len(publisher.publishedPayloads))
	}
	if len(service.listedQueries) != 0 {
		t.Fatal("a message with nowhere to reply still cost a database query")
	}
}

// The response the gallery gets when this service cannot read its own
// database: a 503 with a message about worlds, not about SQL. Section 12's
// rule that a public response model leaks nothing applies to errors too.
func TestTheWorldListQueryReportsAStoreFailureWithoutLeakingIt(t *testing.T) {
	service := &generationServiceSpy{listError: errStoreUnavailable}
	publisher := &recordingResponsePublisher{}
	handler := NewNATSHandler(service, publisher, time.Second)

	handler.HandleLibraryListQuery(libraryQueryMessage(t,
		contracts.LibraryListQueryData{OwnerAccountID: libraryQueryTestOwnerAccountID}, "reply.subject"))

	response := decodeRPCResponse(t, publisher.publishedPayloads[0])
	if response.StatusCode != 503 {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if response.Error == nil || response.Error.Code != "WORLD_LIST_UNAVAILABLE" {
		t.Fatalf("error = %+v, want WORLD_LIST_UNAVAILABLE", response.Error)
	}
	if response.Error.Message == errStoreUnavailable.Error() {
		t.Fatal("the store's own error text reached the visitor")
	}
}
