import type { GenerationJob } from "./types";

/**
 * The one thing this app says about how a world was built, and the three
 * things it deliberately does not say.
 *
 * Design: section 9.1 of
 * agent-system/plans/architecture/end-user-identity-and-ownership.md, and
 * decisions 17 and 17b.
 *
 * **The decision is keyed on the REASON CODE and never on a provider name.**
 * A provider name would reach this module as `mock` in three unrelated
 * situations — the visitor passed their daily limit, the deployment has no AI
 * tier configured at all, or a real provider failed and a fallback answered —
 * and only the first is the visitor's business. Keying on `provider === "mock"`
 * re-merges those three at the last possible moment, in the one place with the
 * least information about which is which, and the observable result is a
 * message that is false in two of the three cases. Production runs
 * `AI_PROVIDER: mock` right now, so the false case is the CURRENT case rather
 * than a hypothetical.
 *
 * Which is why this file never looks at a provider, and why nothing in the
 * gateway's job response carries one.
 */

/** Copy for a visitor who really did pass their allowance today. */
const PRESET_WORLD_SENTENCE = "This one was built from presets.";
const SINGULAR_AI_WORLD_NOUN = "AI world";
const PLURAL_AI_WORLD_NOUN = "AI worlds";

/**
 * A limit of zero is a policy, not a missing value: an operator can set
 * `quota.ai.daily_limit.anonymous` to 0 and turn the AI tier off for anonymous
 * visitors without touching `AI_PROVIDER`. The declared range starts at 0 for
 * exactly that. So it gets its own sentence — "you've used today's 0 AI
 * worlds" is arithmetic, not English.
 */
const AI_SWITCHED_OFF_SENTENCE = `AI worlds are switched off today. ${PRESET_WORLD_SENTENCE}`;

/**
 * And the sentence for a limit the server did not name. Reachable only if a
 * job carries `quota_exhausted` with no limit beside it, which the backend
 * writes as one value — so this is a fallback rather than a case, and it says
 * the true part without inventing a number.
 */
const UNNAMED_LIMIT_SENTENCE = `Today's AI limit is used up. ${PRESET_WORLD_SENTENCE}`;

/**
 * The copy for one exhausted allowance, assembled from the limit the platform
 * actually enforced.
 *
 * The number comes off the job, not out of this file. It is the resolved value
 * of a settings row an operator can change, so a `5` typed in here would be a
 * second declaration of it — which is the mistake the settings registry was
 * moved into `contracts` to avoid, one module further out.
 */
function exhaustedAllowanceSentence(dailyLimit: number): string {
  if (dailyLimit <= 0) {
    return AI_SWITCHED_OFF_SENTENCE;
  }
  const worldNoun = dailyLimit === 1 ? SINGULAR_AI_WORLD_NOUN : PLURAL_AI_WORLD_NOUN;
  return `You've used today's ${dailyLimit} ${worldNoun}. ${PRESET_WORLD_SENTENCE}`;
}

/**
 * What to say about a finished job, or `null` for the three reasons that are
 * not the visitor's.
 *
 * `quota_exhausted` is the only value that produces a message:
 *
 * - `ai_generated` — nothing happened worth saying.
 * - `mock_configured` — there was no AI tier to lose. This is what production
 *   returns today, so the quiet case is the CURRENT case: the app must stay
 *   silent through any number of creates, including well past the daily limit.
 * - `ai_failed_fallback` — an incident, and it belongs to staff. It is already
 *   in `ai_generation_attempts` and in staff telemetry. Showing it to the
 *   visitor blames them for our provider being down.
 *
 * A job with no reason at all is silent too, which covers every job created
 * before the quota shipped and every failed job — a failure has no world, so
 * it has nothing to explain and its own error message already speaks.
 *
 * Only a COMPLETED job speaks. The reason is written when the DNA is stored,
 * which is before composition, so a `processing` job can already carry it —
 * and a message about a world arriving, arriving while a progress overlay is
 * still up, is a message about nothing the visitor can see yet.
 */
export function generationNoticeFor(job: GenerationJob): string | null {
  if (job.status !== "completed") {
    return null;
  }
  if (job.generationReason !== "quota_exhausted") {
    return null;
  }
  if (typeof job.dailyAiGenerationLimit !== "number") {
    return UNNAMED_LIMIT_SENTENCE;
  }
  return exhaustedAllowanceSentence(job.dailyAiGenerationLimit);
}
