package contracts

// The vocabulary of the daily AI quota: what the gateway decided for one
// create, and how the world that create produced was actually built.
//
// Design: section 9 and section 9.1 of
// agent-system/plans/architecture/end-user-identity-and-ownership.md, and
// decisions 8, 17 and 17b.
//
// It lives in `contracts` for the reason the settings registry does: the two
// halves are set in different services. The gateway owns the counter and the
// limits, `dna-service` owns the three provider facts and computes the reason,
// and the web app renders exactly one of the four values. Nothing here is
// policy - the two LIMITS are settings rows (section 9.3), and this file never
// names a number.

// GenerationReason says HOW a world was produced.
//
// It never says why one was NOT produced. A job whose provider failed with no
// distinct fallback configured ends as a FAILED job, and a failed job has no
// world to carry a reason - which is why there are four values here and not
// five, and why `Job.GenerationReason` is empty on every failure.
//
// A reason and not a provider name, which is decision 17b and the one
// correction the owner made to this design by reading it. Three independent
// routes lead to a world built from presets, and only one of them is the
// visitor's business; a provider name forces the web app to guess which, and
// it has no way to know.
type GenerationReason string

const (
	// GenerationReasonAIGenerated is the ordinary case once a real provider is
	// configured: the primary answered and its output passed validation.
	GenerationReasonAIGenerated GenerationReason = "ai_generated"

	// GenerationReasonQuotaExhausted is the ONE value the web app speaks
	// about, because it is the only one that is a fact about the visitor. An
	// AI generation was genuinely withheld from them, they still got a real
	// world, and they can act on it - tomorrow, or by signing up for the
	// larger allowance.
	GenerationReasonQuotaExhausted GenerationReason = "quota_exhausted"

	// GenerationReasonMockConfigured means there was no AI tier to lose:
	// AI_PROVIDER is `mock`, which is what production runs today
	// (render.yaml). It OUTRANKS GenerationReasonQuotaExhausted, and that
	// precedence is the whole of decision 17b: a deployment with no AI
	// withheld nothing from anybody, so a caller past the limit must not be
	// told a limit cost them something. Reversing it announces a limit on an
	// AI tier that is switched off, on every sixth create, in the only
	// environment that currently exists.
	GenerationReasonMockConfigured GenerationReason = "mock_configured"

	// GenerationReasonAIFailedFallback is an incident, and it belongs to
	// staff. A real primary was tried, it failed, and a distinct fallback
	// produced the world. The visitor lost nothing and did nothing; showing it
	// to them blames them for our provider being down. It reaches
	// ai_generation_attempts and staff telemetry, where such things already
	// go.
	GenerationReasonAIFailedFallback GenerationReason = "ai_failed_fallback"
)

// declaredGenerationReasons is every value the enum may take, in the order
// section 9.1 presents them.
//
// A declared list rather than four constants a reader has to find, because two
// things have to stay in step with it: the table-driven test that covers all
// four (three of which cannot be observed in production, because production
// runs on mock), and the CHECK constraint on generation_jobs.generation_reason.
// dna-service has a test that reads this list and fails if the migration's
// CHECK does not admit every value in it - the same class of trap as a new
// world family needing its own CHECK edit.
var declaredGenerationReasons = []GenerationReason{
	GenerationReasonAIGenerated,
	GenerationReasonQuotaExhausted,
	GenerationReasonMockConfigured,
	GenerationReasonAIFailedFallback,
}

// DeclaredGenerationReasons returns a copy, so a caller iterating the list
// cannot reorder the declaration for everybody else.
func DeclaredGenerationReasons() []GenerationReason {
	return append([]GenerationReason(nil), declaredGenerationReasons...)
}

// Valid reports whether a reason is one this contract declares. An empty
// reason is NOT valid: absence is a real state - every job created before this
// shipped, and every failed job - and callers that accept absence check for it
// rather than passing it through here.
func (reason GenerationReason) Valid() bool {
	for _, declaredReason := range declaredGenerationReasons {
		if reason == declaredReason {
			return true
		}
	}
	return false
}

// AIQuotaState is what the gateway enforced for ONE create: the limit it
// measured this caller against, and whether they were past it.
//
// The two travel as one value rather than as two fields on the command, and
// that is deliberate. A limit with no verdict decides nothing, and a verdict
// with no limit cannot be explained to the visitor whose world it changed - so
// there is one field to set, one field to copy, and no way to carry half of
// it. A message rebuilt as a struct literal drops one field as easily as two
// (Phase B correction 8), and grouping means the half that would survive such
// a drop is meaningless rather than plausible.
//
// DailyLimit is carried even when Exhausted is false, because the web app's
// one sentence names the number the platform actually enforced. The
// alternative is a copy of that number in TypeScript, which is precisely the
// two-declarations-of-one-value mistake the settings registry was moved into
// this module to avoid.
type AIQuotaState struct {
	// DailyLimit is the resolved value of quota.ai.daily_limit.anonymous or
	// quota.ai.daily_limit.account - never a literal, and never this file's
	// business to know.
	DailyLimit int `json:"dailyLimit"`
	// Exhausted is true when this create was already past the limit. It is the
	// gateway's verdict, not a count: how many creates a caller has made is
	// the gateway's own Redis counter and travels nowhere.
	Exhausted bool `json:"exhausted"`
}
