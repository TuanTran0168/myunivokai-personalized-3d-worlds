package ownership

import (
	"errors"
	"testing"
)

const (
	ownerAccountIdentifier    = "6b5f1c9a-2f6a-4d5e-9d2c-5a1d3f7b8c90"
	strangerAccountIdentifier = "0f3c2b1a-7e8d-4c6b-9a5f-1d2e3c4b5a60"
)

// These three predicates were byte-identical in three services, which means
// they were also untested in one place: every existing test asks the rule
// through a store, and a store is exactly what these functions do not need.
//
// So this states the rule directly, which is what the original comment said the
// point of separating it was. The tables below are the complete truth table for
// two nullable pointers, not a sample.
func TestMutationPermittedLeavesAnUnownedWorldOpenToAnyone(t *testing.T) {
	owner := ownerAccountIdentifier
	stranger := strangerAccountIdentifier

	cases := []struct {
		description         string
		worldOwnerAccountID *string
		requestingAccountID *string
		expectedError       error
	}{
		{"an unowned world, and nobody signed in", nil, nil, nil},
		{"an unowned world, and a signed-in stranger", nil, &stranger, nil},
		{"an owned world, and its owner", &owner, &owner, nil},
		{"an owned world, and a stranger", &owner, &stranger, ErrNotWorldOwner},
		{"an owned world, and nobody signed in", &owner, nil, ErrNotWorldOwner},
	}

	for _, testCase := range cases {
		t.Run(testCase.description, func(t *testing.T) {
			if err := MutationPermitted(testCase.worldOwnerAccountID, testCase.requestingAccountID); !errors.Is(err, testCase.expectedError) {
				t.Fatalf("MutationPermitted: error = %v, want %v", err, testCase.expectedError)
			}
		})
	}
}

// Deletion is the one mutation that refuses an unowned world, and the two rules
// are checked against each other here rather than in two separate places: the
// row that differs is the whole reason DeletionPermitted exists, and a change
// that quietly made deletion behave like every other mutation would otherwise
// pass every test in this package.
func TestDeletionPermittedRefusesAWorldNobodyCanProveTheyMade(t *testing.T) {
	owner := ownerAccountIdentifier
	stranger := strangerAccountIdentifier

	cases := []struct {
		description           string
		worldOwnerAccountID   *string
		requestingAccountID   *string
		expectedDeletionError error
		expectedMutationError error
	}{
		{"the owner", &owner, &owner, nil, nil},
		{"a stranger", &owner, &stranger, ErrNotWorldOwner, ErrNotWorldOwner},
		{"nobody signed in", &owner, nil, ErrNotWorldOwner, ErrNotWorldOwner},
		{"anyone at all, on an unowned world", nil, &stranger, ErrWorldNotOwned, nil},
		{"nobody signed in, on an unowned world", nil, nil, ErrWorldNotOwned, nil},
	}

	for _, testCase := range cases {
		t.Run(testCase.description, func(t *testing.T) {
			deletionError := DeletionPermitted(testCase.worldOwnerAccountID, testCase.requestingAccountID)
			if !errors.Is(deletionError, testCase.expectedDeletionError) {
				t.Fatalf("DeletionPermitted: error = %v, want %v", deletionError, testCase.expectedDeletionError)
			}
			mutationError := MutationPermitted(testCase.worldOwnerAccountID, testCase.requestingAccountID)
			if !errors.Is(mutationError, testCase.expectedMutationError) {
				t.Fatalf("MutationPermitted: error = %v, want %v", mutationError, testCase.expectedMutationError)
			}
		})
	}
}

// ReadPermitted is defined AS MutationPermitted rather than as a copy of it,
// and this is what keeps that true. The two answers being identical is the
// design: a world a stranger may not publish is a world that stranger may not
// read, and the day those diverge it has to be a decision somebody made, not a
// line somebody forgot to update in one of two places.
func TestReadPermittedIsTheSameRuleAsMutationPermitted(t *testing.T) {
	owner := ownerAccountIdentifier
	stranger := strangerAccountIdentifier
	pointers := []*string{nil, &owner, &stranger}

	for _, worldOwnerAccountID := range pointers {
		for _, requestingAccountID := range pointers {
			readError := ReadPermitted(worldOwnerAccountID, requestingAccountID)
			mutationError := MutationPermitted(worldOwnerAccountID, requestingAccountID)
			if !errors.Is(readError, mutationError) {
				t.Fatalf("owner=%v caller=%v: read error = %v, mutation error = %v",
					worldOwnerAccountID, requestingAccountID, readError, mutationError)
			}
		}
	}
}

// Two different accounts that happen to be held in two different strings are
// still the same account, and two identical strings at different addresses are
// still equal. The predicates compare the values behind the pointers; a
// refactor that compared the pointers themselves would pass every table above,
// because every table above reuses one variable per account.
func TestOwnershipComparesAccountValuesAndNotPointerIdentity(t *testing.T) {
	ownerHeldOnce := ownerAccountIdentifier
	ownerHeldAgain := ownerAccountIdentifier

	if err := MutationPermitted(&ownerHeldOnce, &ownerHeldAgain); err != nil {
		t.Fatalf("the same account in two variables was refused: %v", err)
	}
	if err := DeletionPermitted(&ownerHeldOnce, &ownerHeldAgain); err != nil {
		t.Fatalf("the same account in two variables was refused deletion: %v", err)
	}
}
