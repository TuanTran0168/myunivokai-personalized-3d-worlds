package checkers

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/myunivokai/myunivokai/services/auth-service/internal/breach"
)

const (
	// pwnedRangeBaseURL is Have I Been Pwned's k-anonymity range endpoint. It
	// needs no API key and no account, which is the whole reason this check
	// survived the "keep it simple" cut in the plan's §5.1: it is one HTTP
	// call with no infrastructure behind it.
	pwnedRangeBaseURL = "https://api.pwnedpasswords.com/range/"

	// pwnedHashPrefixLength is the k-anonymity parameter, and it is the only
	// thing that ever leaves this process. Five hex characters of a SHA-1
	// select a bucket of roughly 800 hashes, so the responder learns which
	// bucket was asked about and cannot learn which member of it was meant.
	pwnedHashPrefixLength = 5

	// pwnedRequestTimeout bounds a signup on a slow third party. Short on
	// purpose: this is a call made while a person waits on a form, and the
	// policy above it already treats an unanswered check as "allow" rather
	// than as a failure, so a long timeout would buy a stricter answer at
	// the cost of the signup itself.
	pwnedRequestTimeout = 3 * time.Second

	// pwnedUserAgent is required by the API's own documented terms, which
	// ask callers to identify themselves rather than send a default.
	pwnedUserAgent = "myunivokai-auth-service"

	// pwnedPaddingHeader asks the responder to pad every reply to a uniform
	// size, so an observer who can see the response length cannot infer how
	// many hashes the bucket held.
	pwnedPaddingHeader = "Add-Padding"

	// pwnedSuffixSeparator splits "<hash suffix>:<occurrence count>" in each
	// response line. A padded entry has a count of zero and is a real line
	// in the response, which is why a match must read the count and not
	// merely find the suffix.
	pwnedSuffixSeparator = ":"

	// pwnedPaddedOccurrenceCount is the count a padding entry carries. It is
	// the string "0" rather than a parsed integer because that is all this
	// code needs to know about it, and parsing every count of every line to
	// compare one of them against zero would be work for nothing.
	pwnedPaddedOccurrenceCount = "0"
)

// PwnedRangeChecker answers breach.Checker from Have I Been Pwned's range
// API using k-anonymity: the SHA-1 of the password is computed here, the
// first five hex characters are sent, and the remaining 35 are matched
// against the response locally.
//
// SHA-1 is not a security choice and is not being defended as one — it is
// the digest that corpus is indexed by, so it is the digest a lookup has to
// use. The password's stored form is Argon2id and is produced elsewhere
// (internal/security/password.go); nothing here ever persists anything.
type PwnedRangeChecker struct {
	httpClient *http.Client
	baseURL    string
}

func NewPwnedRangeChecker() PwnedRangeChecker {
	return PwnedRangeChecker{
		httpClient: &http.Client{Timeout: pwnedRequestTimeout},
		baseURL:    pwnedRangeBaseURL,
	}
}

// NewPwnedRangeCheckerWithBaseURL exists for the test that pins what this
// checker sends over the wire. That test is the reason the check is
// implemented behind an interface at all: without an injectable endpoint,
// "no password leaves the process" would be a claim in a comment rather
// than an assertion in CI.
func NewPwnedRangeCheckerWithBaseURL(httpClient *http.Client, baseURL string) PwnedRangeChecker {
	return PwnedRangeChecker{httpClient: httpClient, baseURL: baseURL}
}

func (checker PwnedRangeChecker) Name() breach.CheckerName {
	return breach.CheckerPwnedRange
}

func (checker PwnedRangeChecker) IsBreached(ctx context.Context, password string) (bool, error) {
	hashPrefix, hashSuffix := splitPasswordHash(password)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, checker.baseURL+hashPrefix, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("User-Agent", pwnedUserAgent)
	request.Header.Set(pwnedPaddingHeader, "true")
	response, err := checker.httpClient.Do(request)
	if err != nil {
		return false, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("pwned range lookup returned status %d", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		suffix, occurrenceCount, found := strings.Cut(strings.TrimSpace(scanner.Text()), pwnedSuffixSeparator)
		if !found || !strings.EqualFold(suffix, hashSuffix) {
			continue
		}
		// A padded line matches a suffix that was never in the corpus. Reading
		// the count is what tells the two apart, and skipping it would make
		// the padding header — added above for privacy — reject one password
		// in every bucket at random.
		return strings.TrimSpace(occurrenceCount) != pwnedPaddedOccurrenceCount, nil
	}
	return false, scanner.Err()
}

// splitPasswordHash returns the k-anonymity prefix and the locally-matched
// suffix. It is the only function in this package that sees the password,
// and the only value it returns that is ever transmitted is the prefix.
func splitPasswordHash(password string) (hashPrefix, hashSuffix string) {
	digest := sha1.Sum([]byte(password))
	encoded := strings.ToUpper(hex.EncodeToString(digest[:]))
	return encoded[:pwnedHashPrefixLength], encoded[pwnedHashPrefixLength:]
}
