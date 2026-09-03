package repositories

import (
	"context"
	"errors"
)

// ErrNotWorldOwner is returned when a world HAS an owner and the caller is not
// it. It is deliberately distinct from ErrNotFound: "this world is somebody
// else's" and "this world does not exist" are different answers, and the
// transport turns them into different status codes.
var ErrNotWorldOwner = errors.New("not the world owner")

// assertWorldMutable is the ownership predicate, and where it runs is the
// point: inside the mutation's own transaction, never against a read model,
// and never as a separate round trip a concurrent claim could slip between.
// `FOR UPDATE` holds the row until the mutation commits or rolls back, so the
// answer cannot go stale between the check and the write it authorises.
// The `deleted_at IS NULL` here is not about ownership, and it is the reason
// this lookup is not simply the ownership one: every product READ says a
// deleted world does not exist, so a mutation has to say the same. Without it a
// caller holding the UUID could add variants to, and publish, a world nobody
// can see - writing rows and emitting world-change events for something that
// renders nowhere.
func assertWorldMutable(ctx context.Context, querier worldSnapshotQuerier, worldID string, requestingAccountID *string) error {
	var ownerAccountID *string
	if err := querier.QueryRow(ctx, `SELECT owner_account_id::text FROM worlds WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, worldID).Scan(&ownerAccountID); err != nil {
		return mapNotFound(err)
	}
	return worldMutationPermitted(ownerAccountID, requestingAccountID)
}

// worldMutationPermitted is the rule with no database in it, so both stores
// enforce one implementation of it and a test can state it directly.
//
// It has two halves, and the second is the one that is easy to lose: a world
// with NO owner stays mutable by anyone holding its id. That is today's
// behaviour and it describes every world in production, so a check written as
// "the caller must equal the owner" would refuse all of them at once.
func worldMutationPermitted(ownerAccountID, requestingAccountID *string) error {
	if ownerAccountID == nil {
		return nil
	}
	if requestingAccountID == nil || *requestingAccountID != *ownerAccountID {
		return ErrNotWorldOwner
	}
	return nil
}

// ErrWorldNotOwned is returned when a mutation that requires an owner is asked
// of a world that has none. Only deletion is in that category.
var ErrWorldNotOwned = errors.New("world has no owner")

// worldDeletionPermitted is STRICTER than worldMutationPermitted, and the
// difference is the point.
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
func worldDeletionPermitted(ownerAccountID, requestingAccountID *string) error {
	if ownerAccountID == nil {
		return ErrWorldNotOwned
	}
	if requestingAccountID == nil || *requestingAccountID != *ownerAccountID {
		return ErrNotWorldOwner
	}
	return nil
}

// assertWorldDeletable is assertWorldMutable with the stricter ownership rule,
// and it takes the row the same way: inside the deletion's own transaction, FOR
// UPDATE, so a claim landing at the same moment cannot change the answer
// between the check and the flag.
//
// It deliberately does NOT filter deleted worlds, unlike the lookup above.
// Deleting twice has to answer the way deleting once did - a retried request
// and a second click are the normal cases - and filtering here would turn the
// second one into a 404.
func assertWorldDeletable(ctx context.Context, querier worldSnapshotQuerier, worldID string, requestingAccountID *string) error {
	var ownerAccountID *string
	if err := querier.QueryRow(ctx, `SELECT owner_account_id::text FROM worlds WHERE id = $1 FOR UPDATE`, worldID).Scan(&ownerAccountID); err != nil {
		return mapNotFound(err)
	}
	return worldDeletionPermitted(ownerAccountID, requestingAccountID)
}
