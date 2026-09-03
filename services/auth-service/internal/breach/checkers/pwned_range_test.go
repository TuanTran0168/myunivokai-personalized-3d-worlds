package checkers

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// theProbedPassword is the password every test here checks. It is a distinctive
// string so a search of the recorded request for it cannot match by chance.
const theProbedPassword = "a-very-recognisable-password-value"

func hashOf(password string) (prefix, suffix string) {
	digest := sha1.Sum([]byte(password))
	encoded := strings.ToUpper(hex.EncodeToString(digest[:]))
	return encoded[:pwnedHashPrefixLength], encoded[pwnedHashPrefixLength:]
}

// recordingRangeServer stands in for api.pwnedpasswords.com and keeps
// everything the checker sent, so a test can assert on the request itself
// rather than only on the answer.
type recordingRangeServer struct {
	server          *httptest.Server
	requestedPath   string
	requestedQuery  string
	requestedHeader http.Header
	requestBody     string
}

func newRecordingRangeServer(t *testing.T, responseBody string) *recordingRangeServer {
	t.Helper()
	recorder := &recordingRangeServer{}
	recorder.server = httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		recorder.requestedPath = request.URL.Path
		recorder.requestedQuery = request.URL.RawQuery
		recorder.requestedHeader = request.Header.Clone()
		bodyBuffer := make([]byte, 1024)
		readCount, _ := request.Body.Read(bodyBuffer)
		recorder.requestBody = string(bodyBuffer[:readCount])
		_, _ = responseWriter.Write([]byte(responseBody))
	}))
	t.Cleanup(recorder.server.Close)
	return recorder
}

func (recorder *recordingRangeServer) checker() PwnedRangeChecker {
	return NewPwnedRangeCheckerWithBaseURL(recorder.server.Client(), recorder.server.URL+"/range/")
}

// The assertion the plan's section 5.1 rests on: k-anonymity means the first
// five hex characters of the SHA-1 go out and nothing else does. Without this
// test, "no password ever leaves the service" is a claim in a comment.
func TestPwnedRangeChecker_SendsOnlyTheHashPrefix(t *testing.T) {
	prefix, suffix := hashOf(theProbedPassword)
	recorder := newRecordingRangeServer(t, suffix+":42\n")

	if _, err := recorder.checker().IsBreached(context.Background(), theProbedPassword); err != nil {
		t.Fatalf("check password: %v", err)
	}

	if recorder.requestedPath != "/range/"+prefix {
		t.Fatalf("requested path = %q, want /range/%s", recorder.requestedPath, prefix)
	}
	// Everything the request could possibly carry, searched for the password
	// and for the part of the hash that must stay local. Asserting on the
	// path alone would pass while a query parameter or a header leaked it.
	everythingSent := strings.Join([]string{
		recorder.requestedPath, recorder.requestedQuery, recorder.requestBody,
		fmt.Sprintf("%v", recorder.requestedHeader),
	}, " ")
	if strings.Contains(everythingSent, theProbedPassword) {
		t.Fatalf("the password itself was sent: %q", everythingSent)
	}
	if strings.Contains(strings.ToUpper(everythingSent), suffix) {
		t.Fatalf("the locally-matched hash suffix was sent, which defeats k-anonymity: %q", everythingSent)
	}
	if recorder.requestedHeader.Get(pwnedPaddingHeader) == "" {
		t.Fatal("the padding header was not requested, so the response length leaks the bucket size")
	}
}

func TestPwnedRangeChecker_ReadsTheOccurrenceCountRatherThanTheSuffixAlone(t *testing.T) {
	_, suffix := hashOf(theProbedPassword)
	testCases := []struct {
		name             string
		responseBody     string
		expectedBreached bool
	}{
		{
			name:             "a real corpus entry is a match",
			responseBody:     "0000000000000000000000000000000000A:3\n" + suffix + ":1874\n",
			expectedBreached: true,
		},
		{
			// Requesting padding means the response contains synthetic
			// entries with a count of zero. Matching on the suffix alone
			// would reject one password per bucket at random.
			name:             "a padding entry with a zero count is not a match",
			responseBody:     suffix + ":0\n",
			expectedBreached: false,
		},
		{
			name:             "a bucket that does not contain the suffix is not a match",
			responseBody:     "0000000000000000000000000000000000A:3\n",
			expectedBreached: false,
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := newRecordingRangeServer(t, testCase.responseBody)
			breached, err := recorder.checker().IsBreached(context.Background(), theProbedPassword)
			if err != nil {
				t.Fatalf("check password: %v", err)
			}
			if breached != testCase.expectedBreached {
				t.Fatalf("breached = %v, want %v", breached, testCase.expectedBreached)
			}
		})
	}
}

// A corpus that answers with an error status must produce an error, never
// false. breach.Checker's contract forbids turning "not answered" into "not
// breached", and this is the boundary where that could go wrong silently.
func TestPwnedRangeChecker_ReportsAnErrorRatherThanNotBreached(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusTooManyRequests)
	}))
	t.Cleanup(server.Close)
	checker := NewPwnedRangeCheckerWithBaseURL(server.Client(), server.URL+"/range/")

	breached, err := checker.IsBreached(context.Background(), theProbedPassword)
	if err == nil {
		t.Fatal("a 429 from the corpus produced no error, so an outage would read as 'this password is fine'")
	}
	if breached {
		t.Fatal("breached = true alongside an error, which no caller can interpret")
	}
}
