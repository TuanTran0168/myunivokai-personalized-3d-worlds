package services

import (
	"context"
	"errors"

	"github.com/myunivokai/myunivokai/services/auth-service/internal/breach"
	"github.com/rs/zerolog/log"
)

// ErrPasswordBreached rejects a password that appears in a public breach
// corpus. It is separate from ErrPasswordTooShort because the two produce
// genuinely different advice: one says "make it longer", the other says
// "this exact password is already published, choose a different one".
var ErrPasswordBreached = errors.New("password appears in a known breach corpus")

// PasswordPolicy is the whole of the plan's §5.1 credential rule: at least
// minimumAccountPasswordLength characters, no composition rules, no forced
// rotation, and a rejection if the password appears in a breach corpus.
//
// No composition rules is a decision, not an omission — it is current NIST
// guidance and the opposite of what most products still do. Length plus a
// breach corpus rejects the passwords that are actually guessed; a mandatory
// symbol rejects `correct horse battery staple` and accepts `P@ssw0rd1`.
//
// The breach check matters more here than it would in most products, because
// decision 11 ships without email: with no password reset, a compromised
// account is a *lost* account until Phase D, so the mitigation has to be
// preventative rather than corrective.
type PasswordPolicy struct {
	breachChecker breach.Checker
}

func NewPasswordPolicy(breachChecker breach.Checker) PasswordPolicy {
	return PasswordPolicy{breachChecker: breachChecker}
}

// Validate enforces the policy for a password the account holder chose:
// signup today, and password change when that arrives.
//
// It is deliberately NOT called on login. A person whose existing password
// later appears in a corpus must still be able to sign in — locking them out
// of an account with no reset flow would be the platform destroying access
// rather than protecting it. Plan §5.1 states this as "never block a login
// with it", and it is the reason this method is not reachable from Login.
//
// An unreachable corpus ALLOWS the password, and that asymmetry is the one
// judgement call in this file. breach.Checker's contract refuses to turn an
// error into "not breached" so that the decision is made here, once, where
// it can be argued: a third party being down must not stop people
// registering, and the check is one layer of several (length, Argon2id,
// lockout, rotation, tokenVersion) rather than the thing holding the door.
// The failure is logged because it should be visible, not because the
// request should fail.
func (policy PasswordPolicy) Validate(ctx context.Context, password string) error {
	if len(password) < minimumAccountPasswordLength {
		return ErrPasswordTooShort
	}
	if policy.breachChecker == nil {
		return nil
	}
	breached, err := policy.breachChecker.IsBreached(ctx, password)
	if err != nil {
		log.Warn().Err(err).Str("checker", string(policy.breachChecker.Name())).Msg("breached-password check did not answer; allowing the password")
		return nil
	}
	if breached {
		return ErrPasswordBreached
	}
	return nil
}
