package services

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

var (
	// ErrEmailUnavailable rejects a signup for an address that already holds
	// an account. See SignUpEndUser for why this response is not uniform with
	// a successful one, which the sprint story asked for and which cannot be
	// delivered before email verification exists.
	ErrEmailUnavailable = errors.New("that email address cannot be used for a new account")

	// ErrEmailRequired is the one input rule auth-service enforces itself.
	// Address FORMAT is validated at the gateway, which is the edge that has
	// the caller to report it to; this is the invariant that stops an empty
	// string becoming an account no matter who publishes the query.
	ErrEmailRequired = errors.New("an email address is required")

	// ErrDisplayNameTooLong rejects a display name past
	// contracts.MaximumAccountDisplayNameLength. Enforced here as well as at
	// the gateway for the same reason ErrEmailRequired is: the gateway's check
	// serves the caller a readable message, and this one holds the invariant
	// whoever publishes the query.
	//
	// It rejects rather than truncating. A name silently cut to 32 characters
	// is a person's own name shown back to them wrong, on the one screen that
	// greets them by it, with nothing saying why.
	ErrDisplayNameTooLong = errors.New("that display name is too long")
)

// auditResultEmailUnavailable records a signup that collided with an existing
// address. It is a separate result from a successful register so the two are
// countable apart in the funnel the plan's section 14.2 describes: a rising
// collision rate is people who already have an account and did not realise,
// which is a product signal rather than an error.
const auditResultEmailUnavailable = "email_unavailable"

// SignUpEndUser registers a product account: an email address stored
// unverified, a password, `kind = 'end_user'`, and no role. Nothing is
// mailed, so nothing waits on mail infrastructure - decision 11 and the
// plan's section 5.
//
// It assigns no role and grants no permission, and that is not an omission
// that a later feature fills in. An end-user account holding a permission row
// is the failure decision 1 has to structurally prevent, given that both
// audiences share one `accounts` table: it would be staff access reachable
// through the product's own signup form. The invariant is asserted at the
// repository level by S8-IDENTITY-003 rather than trusted to this function.
//
// # Why this response reveals that an address is registered
//
// S8-IDENTITY-001 asks that "a signup for an email that already exists is
// indistinguishable in the response from one that does not", and in Phase A
// that is not achievable. It is worth writing down why, because the
// requirement reads achievable:
//
//   - Returning a session for a colliding address means verifying the
//     submitted password against the existing account - so a wrong password
//     returns an error a brand-new address never would, and the address is
//     disclosed anyway, now with a password oracle attached.
//   - Returning success with no session, the way a product with email does
//     ("check your inbox"), needs an inbox. Decision 12 puts mail in Phase D.
//   - Returning the same error for both means a new address cannot sign up.
//
// Uniform signup responses require email verification; there is no
// arrangement of a create-and-sign-in endpoint that hides the collision. So
// this returns ErrEmailUnavailable, and the disclosure is accepted and
// recorded rather than hidden behind a comment claiming otherwise. What
// bounds it: the gateway's dedicated `auth` rate-limit bucket is far tighter
// than the product one, the per-email failure counter throttles a distributed
// attempt, and every attempt writes an audit row.
//
// LOGIN is uniform, and stays uniform - see login's decoy hash. That is the
// half of the plan's section 5.1 requirement that is both achievable and
// load-bearing, since it is login an attacker probes to find live accounts.
//
// # The display name
//
// data.Name is optional and is stored as given, trimmed. It is display data:
// nothing reads it to decide anything, it is deliberately NOT unique, and an
// empty one is a valid account whose menu falls back to the email address.
// Uniqueness would be the wrong promise for a name people choose to be
// greeted by, and it would turn "that name is taken" into a second signup
// failure mode on a form that already has one.
func (service *AuthService) SignUpEndUser(ctx context.Context, data contracts.WebSignupData) (contracts.LoginResponseData, error) {
	email := normalizeEmail(data.Email)
	if strings.TrimSpace(email) == "" {
		return contracts.LoginResponseData{}, ErrEmailRequired
	}
	displayName := strings.TrimSpace(data.Name)
	// Counted in runes, not bytes. `len` would let a 32-character name in one
	// alphabet through and refuse the same 32 characters in another - and
	// Vietnamese, which this product is used in, spends up to three bytes on
	// a single letter.
	if len([]rune(displayName)) > contracts.MaximumAccountDisplayNameLength {
		return contracts.LoginResponseData{}, ErrDisplayNameTooLong
	}
	// The password policy runs before the hash, so a rejected password is
	// never put through Argon2id - and before the account is created, so a
	// rejected signup leaves no row behind to collide with the retry.
	if err := service.passwordPolicy.Validate(ctx, data.Password); err != nil {
		return contracts.LoginResponseData{}, err
	}
	passwordHash, err := service.passwordHasher.Hash(data.Password)
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	account, err := service.store.CreateAccount(ctx, repositories.CreateAccountParams{
		Email: email, Name: displayName, PasswordHash: passwordHash, Kind: contracts.AccountKindEndUser,
	})
	if errors.Is(err, repositories.ErrConflict) {
		service.audit(ctx, nil, auditActionRegister, email, auditResultEmailUnavailable, data.SourceAddress)
		return contracts.LoginResponseData{}, ErrEmailUnavailable
	}
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	// Signing up signs the person in, the same way AcceptInvite does. The
	// audience comes from the account's kind inside issueSession, so nothing
	// here names it: an end-user account can only ever produce a `web` token.
	response, err := service.issueSession(ctx, account, uuid.NewString())
	if err != nil {
		return contracts.LoginResponseData{}, err
	}
	service.audit(ctx, &account.ID, auditActionRegister, email, auditResultSuccess, data.SourceAddress)
	return response, nil
}
