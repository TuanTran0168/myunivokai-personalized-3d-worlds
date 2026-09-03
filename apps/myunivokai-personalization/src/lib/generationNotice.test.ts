import { describe, expect, it } from "vitest";
import { generationNoticeFor } from "./generationNotice";
import type { GenerationJob, GenerationReason } from "./types";

function completedJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    jobId: "01JOB",
    family: "universe",
    status: "completed",
    worldId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
    createdAt: "2026-09-03T10:00:00Z",
    updatedAt: "2026-09-03T10:00:20Z",
    ...overrides
  };
}

describe("generationNoticeFor", () => {
  // One fires, three stay silent. The table is written over every value of the
  // union rather than over the interesting one, so a fifth reason added to the
  // contract without a decision here is a compile error rather than a silent
  // fourth kind of silence.
  const reasonExpectations: Record<GenerationReason, "speaks" | "stays silent"> = {
    quota_exhausted: "speaks",
    ai_generated: "stays silent",
    mock_configured: "stays silent",
    ai_failed_fallback: "stays silent"
  };

  for (const [reason, expectation] of Object.entries(reasonExpectations) as [
    GenerationReason,
    "speaks" | "stays silent"
  ][]) {
    it(`${expectation} for ${reason}`, () => {
      const notice = generationNoticeFor(completedJob({ generationReason: reason, dailyAiGenerationLimit: 5 }));
      if (expectation === "speaks") {
        expect(notice).toBeTruthy();
      } else {
        expect(notice).toBeNull();
      }
    });
  }

  // The case production is in right now. Not a hypothetical: render.yaml sets
  // AI_PROVIDER: mock, so every world today comes from presets and NOTHING was
  // withheld from anybody. A toast here announces a limit on an AI tier that is
  // switched off, which is the failure the owner found by reading the design.
  it("stays silent past the daily limit when the deployment has no AI tier", () => {
    for (let createNumber = 1; createNumber <= 10; createNumber += 1) {
      const notice = generationNoticeFor(
        completedJob({ jobId: `01JOB${createNumber}`, generationReason: "mock_configured", dailyAiGenerationLimit: 5 })
      );
      expect(notice).toBeNull();
    }
  });

  it("names the limit the server enforced rather than a number from this app", () => {
    expect(generationNoticeFor(completedJob({ generationReason: "quota_exhausted", dailyAiGenerationLimit: 5 })))
      .toBe("You've used today's 5 AI worlds. This one was built from presets.");
    // An operator raised the limit in the admin app. The sentence follows,
    // with nothing rebuilt and no constant edited here.
    expect(generationNoticeFor(completedJob({ generationReason: "quota_exhausted", dailyAiGenerationLimit: 40 })))
      .toBe("You've used today's 40 AI worlds. This one was built from presets.");
  });

  it("says one world rather than one worlds", () => {
    expect(generationNoticeFor(completedJob({ generationReason: "quota_exhausted", dailyAiGenerationLimit: 1 })))
      .toBe("You've used today's 1 AI world. This one was built from presets.");
  });

  // Zero is a policy an operator can set, not a missing value: it turns the AI
  // tier off for one audience without touching AI_PROVIDER. "You've used
  // today's 0 AI worlds" is arithmetic, not English.
  it("does not tell anybody they used zero AI worlds", () => {
    const notice = generationNoticeFor(completedJob({ generationReason: "quota_exhausted", dailyAiGenerationLimit: 0 }));
    expect(notice).toBe("AI worlds are switched off today. This one was built from presets.");
    expect(notice).not.toContain("0");
  });

  it("says the true part when the server named no limit", () => {
    const notice = generationNoticeFor(completedJob({ generationReason: "quota_exhausted" }));
    expect(notice).toBe("Today's AI limit is used up. This one was built from presets.");
  });

  // The reason is written when the DNA is stored, which is before the world is
  // composed — so a processing job can already carry it. Speaking then is a
  // message about a world the visitor cannot see yet, behind a progress
  // overlay.
  it("waits for the world before saying anything", () => {
    for (const status of ["queued", "processing"] as const) {
      const notice = generationNoticeFor(
        completedJob({ status, generationReason: "quota_exhausted", dailyAiGenerationLimit: 5 })
      );
      expect(notice).toBeNull();
    }
  });

  // Every job made before the quota shipped, and every failure. A failed job
  // has no world to explain and its own error message already speaks.
  it("stays silent for a job with no reason at all", () => {
    expect(generationNoticeFor(completedJob())).toBeNull();
    expect(generationNoticeFor(completedJob({ status: "failed", generationReason: "quota_exhausted" }))).toBeNull();
  });

  // The rule that keeps the three routes distinguishable. A provider name
  // reaching this module would be `mock` in three unrelated situations, and
  // this module has the least information of anywhere in the system about
  // which one it is looking at.
  it("reads nothing but the reason code", () => {
    const jobCarryingAProviderName = {
      ...completedJob({ generationReason: "mock_configured", dailyAiGenerationLimit: 5 }),
      provider: "mock"
    } as GenerationJob;
    expect(generationNoticeFor(jobCarryingAProviderName)).toBeNull();
  });
});
