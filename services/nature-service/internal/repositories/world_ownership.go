package repositories

import (
	"context"

	"github.com/myunivokai/myunivokai/shared/family-platform/go/ownership"
)

// The ownership RULES moved to shared/family-platform/go/ownership on 2026-09-05: they
// were byte-identical in three services, and the file they lived in already
// argued for the move without naming it - "the rule with no database in it, so
// both stores enforce one implementation of it".
//
// The two functions below did NOT move, and the reason is not that they are
// small.
//
// **Where the check runs is as load-bearing as what it decides.** Both take the
// world row FOR UPDATE inside the mutation's own transaction, so the row is held
// until that mutation commits or rolls back, and a claim landing at the same
// moment cannot change the answer between the check and the write it
// authorises. A package of pure predicates cannot express that, and moving
// these there would have quietly turned a transactional check into a separate
// round trip.
//
// They also depend on this package's querier interface and its error mapping,
// which is the smaller reason and the one that is easy to mistake for the whole
// one.

// assertWorldMutable is the ownership rule applied to the row it protects.
//
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
	return ownership.MutationPermitted(ownerAccountID, requestingAccountID)
}

// assertWorldDeletable is assertWorldMutable with the stricter ownership rule,
// and it takes the row the same way.
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
	return ownership.DeletionPermitted(ownerAccountID, requestingAccountID)
}
