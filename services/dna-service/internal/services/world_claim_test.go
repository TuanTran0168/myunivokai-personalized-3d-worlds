package services

import (
	"context"
	"errors"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
)

const (
	claimTestAccountID   = "11111111-1111-1111-1111-111111111111"
	claimTestAnonymousID = "22222222-2222-2222-2222-222222222222"
	claimTestJobID       = "job-claim-1"
)

// alreadyGeneratedDNAVersionID makes EnsureJob's answer look like a job whose
// DNA already exists, which is how Generate returns before it reaches the AI
// orchestrator. That is what lets these tests run with no provider at all:
// what is under test is which fields survive the trip to the store, and the
// generation itself is covered by internal/ai.
const alreadyGeneratedDNAVersionID = "33333333-3333-3333-3333-333333333333"

// storeSpy records what reached the store and nothing else. It implements
// every method of repositories.Store because the interface is what
// GenerationService depends on; the ones no test here calls return zero values
// rather than panicking, so a future test that does call one gets a wrong
// answer to fix rather than a crash to debug.
type storeSpy struct {
	ensuredEnvelopes []contracts.Envelope[contracts.GenerateDNAData]
	claimedEnvelopes []contracts.Envelope[contracts.WorldClaimData]
	claimResult      repositories.ClaimResult
	claimError       error
}

func (spy *storeSpy) EnsureJob(_ context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) (repositories.JobRecord, error) {
	spy.ensuredEnvelopes = append(spy.ensuredEnvelopes, envelope)
	return repositories.JobRecord{
		Job: contracts.Job{
			JobID:        envelope.JobID,
			Family:       envelope.Data.Family,
			Status:       contracts.JobStatusProcessing,
			DNAVersionID: alreadyGeneratedDNAVersionID,
		},
		Input: envelope.Data.Input,
	}, nil
}

func (spy *storeSpy) ClaimWorlds(_ context.Context, envelope contracts.Envelope[contracts.WorldClaimData]) (repositories.ClaimResult, error) {
	spy.claimedEnvelopes = append(spy.claimedEnvelopes, envelope)
	return spy.claimResult, spy.claimError
}

func (spy *storeSpy) MarkJobProcessing(context.Context, string) error { return nil }

func (spy *storeSpy) StoreDNAAndQueueComposition(context.Context, string, contracts.WorldInput, contracts.ProfileDNA, []ai.Attempt, repositories.GenerationOutcome) (contracts.Job, error) {
	return contracts.Job{}, nil
}

func (spy *storeSpy) FailDNAJob(context.Context, string, contracts.WorldFamily, string, string, []ai.Attempt) error {
	return nil
}

func (spy *storeSpy) ApplyFamilyCompleted(context.Context, string, string, contracts.Envelope[contracts.FamilyCompletedData]) error {
	return nil
}

func (spy *storeSpy) ApplyFamilyFailed(context.Context, string, string, contracts.Envelope[contracts.FamilyFailedData]) error {
	return nil
}

func (spy *storeSpy) GetJob(context.Context, string) (contracts.Job, error) {
	return contracts.Job{}, nil
}

func (spy *storeSpy) PendingOutbox(context.Context, int) ([]repositories.OutboxMessage, error) {
	return nil, nil
}

func (spy *storeSpy) MarkOutboxPublished(context.Context, string) error { return nil }

func (spy *storeSpy) Ping(context.Context) error { return nil }

func validGenerateInput() contracts.WorldInput {
	return contracts.WorldInput{
		Nickname:            "Nova",
		Interests:           []string{"AI", "Music", "Space"},
		Traits:              []string{"Curious", "Calm", "Focused"},
		Goal:                "Build a meaningful creative universe",
		Mood:                "curious",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "nebula",
	}
}

// The regression this file was written for, and it shipped: Generate rebuilt
// the envelope as a literal naming Family and Input, which dropped
// OwnerAccountID on the floor. The gateway stamped the owner from a verified
// token, this service wrote NULL, and every world made by a signed-in visitor
// was stored as anonymous — with every test in the repository still passing,
// because nothing asserted the field survived the one line that normalizes the
// input.
//
// Asserted field by field rather than with a struct comparison, so the failure
// message names the field that was lost.
func TestGenerateCarriesTheIdentityFieldsThroughNormalization(t *testing.T) {
	ownerAccountID := claimTestAccountID
	anonymousID := claimTestAnonymousID
	spy := &storeSpy{}
	service := NewGenerationService(config.Config{}, spy, nil)

	envelope := contracts.NewEnvelope("job-1", contracts.GenerateDNAData{
		Family:         contracts.WorldFamilyUniverse,
		Input:          validGenerateInput(),
		OwnerAccountID: &ownerAccountID,
		AnonymousID:    &anonymousID,
	})
	if err := service.Generate(context.Background(), envelope); err != nil {
		t.Fatal(err)
	}
	if len(spy.ensuredEnvelopes) != 1 {
		t.Fatalf("EnsureJob calls = %d, want 1", len(spy.ensuredEnvelopes))
	}
	stored := spy.ensuredEnvelopes[0].Data
	if stored.OwnerAccountID == nil || *stored.OwnerAccountID != ownerAccountID {
		t.Errorf("owner reaching the store = %v, want %q. The gateway is the only thing that may set an owner, so an owner dropped here can never be recovered - the claim matches on the anonymous id, not on a world id", stored.OwnerAccountID, ownerAccountID)
	}
	if stored.AnonymousID == nil || *stored.AnonymousID != anonymousID {
		t.Errorf("anonymous id reaching the store = %v, want %q. Without it on the profile row there is nothing for a signup to claim, and the visitor's worlds stay anonymous for ever", stored.AnonymousID, anonymousID)
	}
	if stored.Family != contracts.WorldFamilyUniverse {
		t.Errorf("family reaching the store = %q, want universe", stored.Family)
	}
	// The one field normalization is actually for, asserted alongside so a
	// future rewrite cannot fix the identity fields by dropping the trimming.
	if stored.Input.Mood != "curious" {
		t.Errorf("normalized mood = %q, want curious", stored.Input.Mood)
	}
}

// The mood arrives mixed-case and padded, and has to reach the store lowered
// and trimmed. Paired with the test above because the two pull in opposite
// directions: one wants every field carried through untouched, the other wants
// exactly one field rewritten.
func TestGenerateStillNormalizesTheInputItCarries(t *testing.T) {
	spy := &storeSpy{}
	service := NewGenerationService(config.Config{}, spy, nil)

	input := validGenerateInput()
	input.Mood = "  CURIOUS  "
	input.Nickname = "  Nova  "
	envelope := contracts.NewEnvelope("job-1", contracts.GenerateDNAData{Family: contracts.WorldFamilyUniverse, Input: input})
	if err := service.Generate(context.Background(), envelope); err != nil {
		t.Fatal(err)
	}
	stored := spy.ensuredEnvelopes[0].Data.Input
	if stored.Mood != "curious" || stored.Nickname != "Nova" {
		t.Errorf("normalized input = mood %q nickname %q, want %q and %q", stored.Mood, stored.Nickname, "curious", "Nova")
	}
}

// A claim is two UUIDs and nothing else, and both of them reach a `WHERE`
// clause: the account id becomes an owner, the anonymous id selects the rows.
// A malformed one has to be refused BEFORE the store, because the alternative
// is a transaction that fails partway through a fan-out.
//
// The empty account id is the case worth naming: it would be an UPDATE setting
// owner_account_id to nothing across every unowned profile carrying that
// anonymous id.
func TestAClaimIsRefusedUnlessBothIdentifiersAreUUIDs(t *testing.T) {
	claims := []struct {
		description string
		accountID   string
		anonymousID string
		accepted    bool
	}{
		{description: "two UUIDs", accountID: claimTestAccountID, anonymousID: claimTestAnonymousID, accepted: true},
		{description: "no account id", accountID: "", anonymousID: claimTestAnonymousID},
		{description: "no anonymous id", accountID: claimTestAccountID, anonymousID: ""},
		{description: "an account id that is not a UUID", accountID: "somebody", anonymousID: claimTestAnonymousID},
		{description: "an anonymous id that is not a UUID", accountID: claimTestAccountID, anonymousID: "1"},
		{description: "a UUID with a trailing segment", accountID: claimTestAccountID, anonymousID: claimTestAnonymousID + "-extra"},
	}
	for _, claim := range claims {
		t.Run(claim.description, func(t *testing.T) {
			spy := &storeSpy{}
			service := NewGenerationService(config.Config{}, spy, nil)
			envelope := contracts.NewEnvelope(claimTestJobID, contracts.WorldClaimData{
				AccountID: claim.accountID, AnonymousID: claim.anonymousID,
			})
			err := service.ClaimWorlds(context.Background(), envelope)
			if claim.accepted {
				if err != nil {
					t.Fatalf("a valid claim was refused: %v", err)
				}
				if len(spy.claimedEnvelopes) != 1 {
					t.Fatalf("store claims = %d, want 1", len(spy.claimedEnvelopes))
				}
				return
			}
			if err == nil {
				t.Fatal("an invalid claim was accepted")
			}
			if len(spy.claimedEnvelopes) != 0 {
				t.Fatalf("an invalid claim reached the store: %+v", spy.claimedEnvelopes[0].Data)
			}
		})
	}
}

// A claim that matched nothing is a success, and it has to be: a visitor who
// signs in on a second device replays a claim whose worlds are already owned,
// and answering that with an error would put the message back on the stream to
// fail again for ever.
func TestAClaimThatMatchedNothingSucceeds(t *testing.T) {
	spy := &storeSpy{claimResult: repositories.ClaimResult{}}
	service := NewGenerationService(config.Config{}, spy, nil)
	envelope := contracts.NewEnvelope(claimTestJobID, contracts.WorldClaimData{
		AccountID: claimTestAccountID, AnonymousID: claimTestAnonymousID,
	})
	if err := service.ClaimWorlds(context.Background(), envelope); err != nil {
		t.Fatalf("a replayed claim must succeed, not retry for ever: %v", err)
	}
}

// A database failure, by contrast, must surface — the consumer retries it, and
// the claim's consumer is deliberately unbounded because there is nowhere a
// terminal claim failure could be reported to.
func TestAClaimThatFailedInTheStoreIsRetried(t *testing.T) {
	storeFailure := errors.New("connection refused")
	spy := &storeSpy{claimError: storeFailure}
	service := NewGenerationService(config.Config{}, spy, nil)
	envelope := contracts.NewEnvelope(claimTestJobID, contracts.WorldClaimData{
		AccountID: claimTestAccountID, AnonymousID: claimTestAnonymousID,
	})
	if err := service.ClaimWorlds(context.Background(), envelope); !errors.Is(err, storeFailure) {
		t.Fatalf("error = %v, want the store's own failure so the message is nacked and retried", err)
	}
}
