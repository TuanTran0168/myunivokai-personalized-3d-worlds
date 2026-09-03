// Package breach declares auth-service's boundary with a breached-password
// corpus, and nothing else. The one implementation that talks to a real
// service lives in internal/breach/checkers, following the same rule
// AGENTS.md sets for internal/ai/providers: vendor-specific logic stays in
// the provider package, the business service depends only on the interface,
// and tests use the mock.
package breach

import "context"

// CheckerName identifies which corpus answered, for the same reason
// ai.ProviderName exists: a log line or a test that has to say which
// implementation ran should not have to infer it from behaviour.
type CheckerName string

const (
	CheckerPwnedRange CheckerName = "pwned-range"
	CheckerMock       CheckerName = "mock"
)

// Checker reports whether a password appears in a known breach corpus.
//
// The contract has one deliberate asymmetry, and every implementation and
// every caller depends on it: an error means "not answered", never "not
// breached". A corpus that cannot be reached must not silently turn into a
// permissive answer, so IsBreached returns the error and the caller decides
// what an unanswered check means — see PasswordPolicy.
//
// The password is passed whole because a k-anonymity implementation needs to
// hash it locally; that is precisely the work an implementation must do
// instead of sending it anywhere. Nothing in this interface permits a
// password to leave the process, and PwnedRangeChecker has a test pinning
// that it does not.
type Checker interface {
	Name() CheckerName
	IsBreached(ctx context.Context, password string) (bool, error)
}
