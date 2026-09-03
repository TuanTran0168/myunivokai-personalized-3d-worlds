package repositories

import (
	"context"
	"encoding/json"
	"errors"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
)

var ErrNotFound = errors.New("not found")

type JobRecord struct {
	Job     contracts.Job
	Input   contracts.WorldInput
	Created bool
}

type OutboxMessage struct {
	ID        string
	MessageID string
	Subject   string
	Payload   json.RawMessage
}

// ClaimResult is what one claim did. It exists for the log line rather than
// for a caller that changes behaviour on it: a claim answers nobody — the
// visitor's request was accepted at the gateway and returned long before this
// runs — so "how many profiles, which families" is the only way to tell a
// claim that moved something from one that matched nothing.
type ClaimResult struct {
	ClaimedProfileCount int64
	NotifiedFamilies    []contracts.WorldFamily
}

// GenerationOutcome is how one world was produced: the reason, and the daily
// limit that reason was measured against.
//
// One value rather than two arguments, for the reason contracts.AIQuotaState
// is one value: the limit explains the reason and the reason gives the limit
// its meaning, so there is no call site that should be able to store half of
// it.
//
// Both are absent for a job whose command carried no quota verdict, which is
// every job created before the quota shipped. The limit is a POINTER so that
// absence stays distinct from a limit of zero — which is a policy an operator
// can set, and which turns the AI tier off for one audience without touching
// AI_PROVIDER.
type GenerationOutcome struct {
	Reason                 contracts.GenerationReason
	DailyAIGenerationLimit *int
}

type Store interface {
	EnsureJob(context.Context, contracts.Envelope[contracts.GenerateDNAData]) (JobRecord, error)
	MarkJobProcessing(context.Context, string) error
	StoreDNAAndQueueComposition(context.Context, string, contracts.WorldInput, contracts.ProfileDNA, []ai.Attempt, GenerationOutcome) (contracts.Job, error)
	FailDNAJob(context.Context, string, contracts.WorldFamily, string, string, []ai.Attempt) error
	ApplyFamilyCompleted(context.Context, string, string, contracts.Envelope[contracts.FamilyCompletedData]) error
	ApplyFamilyFailed(context.Context, string, string, contracts.Envelope[contracts.FamilyFailedData]) error
	ClaimWorlds(context.Context, contracts.Envelope[contracts.WorldClaimData]) (ClaimResult, error)
	GetJob(context.Context, string) (contracts.Job, error)
	ListOwnedWorlds(context.Context, contracts.LibraryListQueryData) (contracts.LibraryListResponseData, error)
	PendingOutbox(context.Context, int) ([]OutboxMessage, error)
	MarkOutboxPublished(context.Context, string) error
	Ping(context.Context) error
}
