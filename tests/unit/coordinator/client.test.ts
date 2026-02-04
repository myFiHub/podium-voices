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

  it("requestTurn returns false when server is unreachable", async () => {
    const client = new CoordinatorClient({
      baseUrl: "http://localhost:99999",
      agentId: "test",
      displayName: "Test",
      decisionTimeoutMs: 100,
      pollIntervalMs: 20,
    });
    const allowed = await client.requestTurn("hello");
    expect(allowed).toBe(false);
  });
});
