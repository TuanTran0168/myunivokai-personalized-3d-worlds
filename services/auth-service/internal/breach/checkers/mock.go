package checkers

import (
	"context"
	"errors"

	"github.com/myunivokai/myunivokai/services/auth-service/internal/breach"
)

// ErrMockCheckerUnavailable is what a MockChecker configured to fail returns,
// so a test can exercise the "corpus did not answer" branch of
// PasswordPolicy without a network at all.
var ErrMockCheckerUnavailable = errors.New("mock breach checker is unavailable")

// MockChecker answers from a fixed set of passwords instead of a network,
// following AGENTS.md's rule that tests use the mock. It is not a test
// helper living in a _test.go file on purpose: the same rule applies to a
// local development run with no internet, where a signup should not be
// gated on reaching a third party.
type MockChecker struct {
	breachedPasswords map[string]struct{}
	unavailable       bool
}

func NewMockChecker(breachedPasswords ...string) MockChecker {
	corpus := make(map[string]struct{}, len(breachedPasswords))
	for _, password := range breachedPasswords {
		corpus[password] = struct{}{}
	}
	return MockChecker{breachedPasswords: corpus}
}

// NewUnavailableMockChecker always fails to answer, which is the case the
// breach.Checker contract's one asymmetry exists for: an error must never be
// read as "not breached".
func NewUnavailableMockChecker() MockChecker {
	return MockChecker{unavailable: true}
}

func (checker MockChecker) Name() breach.CheckerName {
	return breach.CheckerMock
}

func (checker MockChecker) IsBreached(_ context.Context, password string) (bool, error) {
	if checker.unavailable {
		return false, ErrMockCheckerUnavailable
	}
	_, breached := checker.breachedPasswords[password]
	return breached, nil
}
