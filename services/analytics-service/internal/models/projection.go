package models

import (
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// InboxMessage is the idempotency key for one delivered event. MessageID is
// the publisher's outbox message id, carried on the NATS Msg-Id header —
// JetStream will deliver the same one more than once, and this is what makes
// that a non-event.
type InboxMessage struct {
	MessageID string
	Subject   string
	JobID     string
}

// JobEvent is what an event says about a job's lifecycle. Terminal marks the
// events that end a job, which is the only point a completed_at and therefore
// a duration exist.
type JobEvent struct {
	JobID        string
	Family       contracts.WorldFamily
	Status       contracts.JobStatus
	ErrorCode    string
	ErrorMessage string
	WorldID      string
	ProfileID    string
	DNAVersionID string
	OccurredAt   time.Time
	Terminal     bool
}

// Projection is one event's complete effect on the read model, applied in one
// transaction together with its inbox row. Either half may be nil: a
// dna.generated event moves a job and touches no world; a world.changed event
// moves a world and says nothing about the job.
type Projection struct {
	Message      InboxMessage
	Job          *JobEvent
	Snapshot     *contracts.WorldSnapshot
	ServiceStart *ServiceStart
}

// ServiceStart is a process announcing that it came up. Unlike every other
// field on Projection it is not derived from anything - see
// migrations/000002_service_starts.sql.
type ServiceStart struct {
	Service        string
	InstanceID     string
	Version        string
	BootDurationMS int64
	StartedAt      time.Time
}

// ServiceStartListFilter mirrors contracts.ServiceStartListQueryData with the
// cursor already decoded.
type ServiceStartListFilter struct {
	Service  string
	PageSize int
	Cursor   string
}

// WorldListFilter mirrors contracts.AnalyticsWorldListQueryData with the
// cursor already decoded. Published is a pointer so "any" stays
// distinguishable from "explicitly unpublished". Since/Until bound
// WorldCreatedAt. Search matches Nickname.
type WorldListFilter struct {
	Family     contracts.WorldFamily
	Archetype  string
	WorldStyle string
	Mood       string
	Published  *bool
	Since      *time.Time
	Until      *time.Time
	Search     string
	// RareFeature is a contracts.RarityCatalogue key. It selects the worlds
	// whose stored draw came in under that feature's current probability.
	RareFeature string
	Cursor      string
	PageSize    int
}

// Since/Until bound CreatedAt. Search matches JobID or ErrorMessage.
type JobListFilter struct {
	Family    contracts.WorldFamily
	Status    contracts.JobStatus
	ErrorCode string
	Since     *time.Time
	Until     *time.Time
	Search    string
	Cursor    string
	PageSize  int
}

type OverviewFilter struct {
	Family contracts.WorldFamily
	Days   int
}
