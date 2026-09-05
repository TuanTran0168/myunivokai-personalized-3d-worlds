// Package ownership holds the rules that decide who may read, mutate and
// delete a world.
//
// It exists because the file it came from said so. The three family services
// each carried a byte-identical `internal/repositories/world_ownership.go` -
// `diff` exited 0 between all three, with no normalisation - and its own
// comment already argued for this package without naming it:
//
//	worldMutationPermitted is the rule with no database in it, so both stores
//	enforce one implementation of it and a test can state it directly.
//
// One implementation for two stores was right. One implementation for two
// stores in three services is what this package makes true.
//
// # What belongs here, and what does not
//
// A function here answers an authorization question from values alone. It
// takes no context, opens no transaction and touches no database, which is
// what lets a test state the rule directly instead of building a store to ask
// it through.
//
// The SQL that loads the owner does NOT belong here and deliberately stayed
// behind in each service's repositories package: `assertWorldMutable` and
// `assertWorldDeletable` take the world row `FOR UPDATE` inside the mutation's
// own transaction, and they depend on that package's querier interface and its
// error mapping. Moving them would have meant inventing an abstraction over
// two things that are already correct where they are.
//
// That split is also the security property, so it is worth saying plainly:
// **where the check runs is as load-bearing as what it decides.** A mutation
// holds the row until it commits, so a claim landing at the same moment cannot
// change the answer between the check and the write it authorises. This
// package cannot express that, and must never be read as if it did.
package ownership

import "errors"

// ErrNotWorldOwner is returned when a world HAS an owner and the caller is not
// it. It is deliberately distinct from a not-found error: "this world is
// somebody else's" and "this world does not exist" are different answers, and
// the transport turns them into different status codes.
var ErrNotWorldOwner = errors.New("not the world owner")

// ErrWorldNotOwned is returned when a mutation that requires an owner is asked
// of a world that has none. Only deletion is in that category.
var ErrWorldNotOwned = errors.New("world has no owner")

// MutationPermitted is the rule with no database in it, so both stores in all
// three family services enforce one implementation of it.
//
// It has two halves, and the second is the one that is easy to lose: a world
// with NO owner stays mutable by anyone holding its id. That is today's
// behaviour and it describes every world in production, so a check written as
// "the caller must equal the owner" would refuse all of them at once.
func MutationPermitted(ownerAccountID, requestingAccountID *string) error {
	if ownerAccountID == nil {
		return nil
	}
	if requestingAccountID == nil || *requestingAccountID != *ownerAccountID {
		return ErrNotWorldOwner
	}
	return nil
}

// ReadPermitted decides whether a caller may READ a world, and it is
// deliberately the same predicate as MutationPermitted rather than a second
// rule kept in step with it by hand.
//
// It is a function of two pointers, with no database in it, because the read
// path has no transaction to run inside and needs none. A mutation takes the
// row FOR UPDATE and checks the owner there, so a claim landing at the same
// moment cannot change the answer between the check and the write it
// authorises. A read authorises nothing, so the owner already loaded with the
// world is enough - and loading it costs nothing extra, because the world
// select columns have always included owner_account_id.
//
// The refusal is ErrNotWorldOwner, which the transport turns into
// 403 NOT_WORLD_OWNER: the same answer the write path already gives for the
// same world. A 404 would hide the world's existence instead, but the write
// path discloses it anyway, so a 404 on the read alone would be a half-measure
// - it would cost a real visitor the one sentence that explains what happened,
// and buy a stranger nothing they could not get from a POST.
func ReadPermitted(ownerAccountID, requestingAccountID *string) error {
	return MutationPermitted(ownerAccountID, requestingAccountID)
}

// DeletionPermitted is STRICTER than MutationPermitted, and the difference is
// the point.
//
// Every other mutation stays open on an unowned world, because that describes
// every world in production and adding a variant to somebody else's world is
// annoying and reversible. Deleting is neither: it takes a world out of its
// maker's gallery, and a visitor cannot put it back. So an unowned world cannot
// be deleted at all - nobody can prove they made it, which is the same reason
// decision 16 leaves a pre-plan world unclaimable.
//
// What makes that acceptable rather than a dead end is the claim
// (S8-IDENTITY-011): a world made before signing up becomes owned, and
// deletable, the moment its maker claims it.
func DeletionPermitted(ownerAccountID, requestingAccountID *string) error {
	if ownerAccountID == nil {
		return ErrWorldNotOwned
	}
	if requestingAccountID == nil || *requestingAccountID != *ownerAccountID {
		return ErrNotWorldOwner
	}
	return nil
}
