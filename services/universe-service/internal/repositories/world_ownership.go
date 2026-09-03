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
func assertWorldMutable(ctx context.Context, querier worldSnapshotQuerier, worldID string, requestingAccountID *string) error {
	var ownerAccountID *string
	if err := querier.QueryRow(ctx, `SELECT owner_account_id::text FROM worlds WHERE id = $1 FOR UPDATE`, worldID).Scan(&ownerAccountID); err != nil {
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
