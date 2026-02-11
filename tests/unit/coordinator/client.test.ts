/**
 * Unit tests for Turn Coordinator client.
 */

import { computeRequestId, CoordinatorClient } from "../../../src/coordinator/client";

describe("computeRequestId", () => {
  it("is deterministic for the same transcript", () => {
    const a = computeRequestId("Hello world");
    const b = computeRequestId("Hello world");
    expect(a).toBe(b);
  });

  it("differs for different transcripts", () => {
    expect(computeRequestId("Hello")).not.toBe(computeRequestId("World"));
  });

  it("normalizes whitespace and case", () => {
    const a = computeRequestId("  Hello   World  ");
    const b = computeRequestId("hello world");
    expect(a).toBe(b);
  });
});

describe("CoordinatorClient", () => {
  it("syncRecentTurns returns empty when server returns non-ok", async () => {
    const client = new CoordinatorClient({
      baseUrl: "http://localhost:99999",
      agentId: "test",
      displayName: "Test",
    });
    const turns = await client.syncRecentTurns();
    expect(turns).toEqual([]);
  });

  it("requestTurn returns { allowed: false } when server is unreachable", async () => {
    const client = new CoordinatorClient({
      baseUrl: "http://localhost:99999",
      agentId: "test",
      displayName: "Test",
      decisionTimeoutMs: 100,
      pollIntervalMs: 20,
    });
    const result = await client.requestTurn("hello");
    expect(result).toEqual({ allowed: false });
  });

  it("endTurn sends turnId in body when provided", async () => {
    const client = new CoordinatorClient({
      baseUrl: "http://localhost:99999",
      agentId: "test",
      displayName: "Test",
    });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await client.endTurn("user msg", "assistant msg", "turn-uuid-123");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/end-turn"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("turn-uuid-123"),
      })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.turnId).toBe("turn-uuid-123");
    fetchSpy.mockRestore();
  });
});
