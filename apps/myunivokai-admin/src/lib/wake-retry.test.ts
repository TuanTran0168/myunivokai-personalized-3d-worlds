import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithWakeRetry } from "./wake-retry";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) }
  });
}

const waking = () => jsonResponse(503, { error: { code: "SERVICE_WAKING" } }, { "Retry-After": "1" });

describe("fetchWithWakeRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function runWith(responses: Response[]): Promise<{ response: Response; calls: number }> {
    const fetchMock = vi.fn(async () => responses.shift() ?? jsonResponse(500, {}));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchWithWakeRetry("/api/admin/overview");
    await vi.runAllTimersAsync();
    return { response: await pending, calls: fetchMock.mock.calls.length };
  }

  it("returns a successful response without retrying", async () => {
    const { response, calls } = await runWith([jsonResponse(200, { ok: true })]);
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("waits out SERVICE_WAKING and returns the response that follows", async () => {
    const { response, calls } = await runWith([waking(), waking(), jsonResponse(200, { ok: true })]);
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });

  // The status alone is not enough to decide: 503 also carries
  // SERVICE_UNAVAILABLE, which is a real fault, and GATEWAY_UNREACHABLE from
  // the BFF relay itself. Retrying either would just delay the error.
  it("does not retry a 503 that is not SERVICE_WAKING", async () => {
    const { response, calls } = await runWith([
      jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE" } }),
      jsonResponse(200, { ok: true })
    ]);
    expect(response.status).toBe(503);
    expect(calls).toBe(1);
  });

  it("does not retry other failures", async () => {
    const { response, calls } = await runWith([jsonResponse(401, { error: { code: "UNAUTHORIZED" } })]);
    expect(response.status).toBe(401);
    expect(calls).toBe(1);
  });

  // A service that never comes back must surface as an error rather than
  // leaving a screen on its loading skeleton forever.
  it("gives up after a bounded number of attempts", async () => {
    const { response, calls } = await runWith(Array.from({ length: 20 }, waking));
    expect(response.status).toBe(503);
    expect(calls).toBe(7);
  });

  it("reports each wait so a screen can explain the delay", async () => {
    const onWaking = vi.fn();
    const responses = [waking(), waking(), jsonResponse(200, { ok: true })];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    const pending = fetchWithWakeRetry("/api/admin/overview", undefined, onWaking);
    await vi.runAllTimersAsync();
    await pending;
    expect(onWaking).toHaveBeenCalledTimes(2);
    expect(onWaking).toHaveBeenNthCalledWith(1, 1);
  });

  // The body is read through a clone precisely so the caller still gets an
  // unconsumed stream; adminRequest calls response.text() right after this.
  it("leaves the returned body readable by the caller", async () => {
    const { response } = await runWith([waking(), jsonResponse(200, { worlds: [] })]);
    await expect(response.json()).resolves.toEqual({ worlds: [] });
  });

  // A request that never gets a response at all (dropped connection, a dev
  // server still compiling this route) must not hang here forever with no
  // retry count to exhaust it — that gap, not SERVICE_WAKING, is what a
  // stuck screen only F5 could fix actually was.
  function requestInitOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): RequestInit | undefined {
    return (fetchMock.mock.calls[callIndex] as unknown as [RequestInfo | URL, RequestInit?])[1];
  }

  it("passes an abort signal to fetch so a request with no response cannot hang forever", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithWakeRetry("/api/admin/overview");
    expect(requestInitOf(fetchMock)?.signal).toBeInstanceOf(AbortSignal);
  });

  it("respects a caller-supplied signal instead of overriding it", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithWakeRetry("/api/admin/overview", { signal: controller.signal });
    expect(requestInitOf(fetchMock)?.signal).toBe(controller.signal);
  });

  it("propagates an abort instead of retrying when the underlying fetch never responds", async () => {
    const abortError = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const fetchMock = vi.fn(async () => {
      throw abortError;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithWakeRetry("/api/admin/overview")).rejects.toThrow(abortError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
