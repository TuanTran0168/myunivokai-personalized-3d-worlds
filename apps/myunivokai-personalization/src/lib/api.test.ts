import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiErrorMessage } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiErrorMessage", () => {
  it("surfaces the backend field-level validation message instead of the generic one", () => {
    const error = new ApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        details: [{ field: "goal", message: "Goal must be 10-220 characters." }],
        requestId: "req_123"
      }
    });
    expect(apiErrorMessage(error)).toBe("Goal must be 10-220 characters. (req_123)");
  });

  it("joins multiple field messages", () => {
    const error = new ApiError(400, {
      error: {
        message: "Please check the highlighted fields.",
        details: [
          { field: "goal", message: "Goal must be 10-220 characters." },
          { field: "interests", message: "Choose 3-8 interests." }
        ]
      }
    });
    expect(apiErrorMessage(error)).toBe("Goal must be 10-220 characters. Choose 3-8 interests.");
  });

  it("falls back to the generic message when there are no details", () => {
    const error = new ApiError(404, { error: { message: "World not found", requestId: "req_9" } });
    expect(apiErrorMessage(error)).toBe("World not found (req_9)");
  });
});

describe("asynchronous generation", () => {
  it("accepts a job, polls it, then loads the completed world", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        jobId: "job-1",
        family: "universe",
        status: "queued",
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:00Z"
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        jobId: "job-1",
        family: "universe",
        status: "completed",
        worldId: "world-1",
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:01Z"
      }))
      .mockResolvedValueOnce(jsonResponse({
        world: { id: "world-1", nickname: "Nova" },
        variants: [{ id: "variant-1", selected: true, sceneConfig: { sceneType: "universe" } }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const world = await api.createWorld(validWorldInput(), "universe");

    expect(world.id).toBe("world-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:41800/api/universe/worlds");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:41800/api/jobs/job-1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:41800/api/universe/worlds/world-1");
  });

  it("surfaces a terminal generation failure without loading a world", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        jobId: "job-2",
        family: "nature",
        status: "queued",
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:00Z"
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        jobId: "job-2",
        family: "nature",
        status: "failed",
        error: { code: "AI_FAILED", message: "DNA generation failed." },
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:01Z"
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.createWorld(validWorldInput(), "nature")).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "DNA generation failed."
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function validWorldInput() {
  return {
    nickname: "Nova",
    role: "Builder",
    interests: ["AI", "music", "space"],
    traits: ["curious", "calm", "focused"],
    goal: "Build a meaningful creative universe",
    mood: "curious",
    favoriteColors: ["#8B5CF6"],
    preferredWorldStyle: "nebula"
  };
}
