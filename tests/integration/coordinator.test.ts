/**
 * Integration tests for Turn Coordinator HTTP API.
 * Starts the coordinator server on a random port, then exercises endpoints.
 */

import * as http from "http";

let server: http.Server;
let baseUrl: string;

beforeAll(() => {
  process.env.COORDINATOR_PORT = "0";
  const mod = require("../../src/coordinator/index");
  server = mod.server;
  const addr = server.address();
  const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 3001;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll((done) => {
  server.close(done);
});

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, init);
  return res.json();
}

describe("Turn Coordinator HTTP API", () => {
  it("GET /recent-turns returns empty turns initially", async () => {
    const data = (await fetchJson("/recent-turns")) as { turns?: unknown[] };
    expect(Array.isArray(data.turns)).toBe(true);
    expect(data.turns).toHaveLength(0);
  });

  it("POST /request-turn then GET /turn-decision returns turnId and leaseMs when allowed", async () => {
    const r1 = "req-lease-" + Date.now();
    await fetch(`${baseUrl}/request-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "alex", displayName: "Alex", transcript: "Hi", requestId: r1 }),
    });
    await new Promise((r) => setTimeout(r, 400));
    const decision = (await fetchJson(`/turn-decision?requestId=${r1}&agentId=alex`)) as {
      decided?: boolean;
      allowed?: boolean;
      turnId?: string;
      leaseMs?: number;
    };
    expect(decision.decided).toBe(true);
    expect(decision.allowed).toBe(true);
    expect(typeof decision.turnId).toBe("string");
    expect(decision.turnId!.length).toBeGreaterThan(0);
    expect(typeof decision.leaseMs).toBe("number");
    expect(decision.leaseMs).toBeGreaterThan(0);
    // Release the turn so subsequent tests can get a grant.
    await fetch(`${baseUrl}/end-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "alex", userMessage: "Hi", assistantMessage: "Ok", turnId: decision.turnId }),
    });
  });

  it("POST /end-turn with matching turnId appends turn and GET /recent-turns returns it", async () => {
    const r1 = "req-end-" + Date.now();
    await fetch(`${baseUrl}/request-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "alex", displayName: "Alex", transcript: "Hello", requestId: r1 }),
    });
    await new Promise((r) => setTimeout(r, 400));
    const decision = (await fetchJson(`/turn-decision?requestId=${r1}&agentId=alex`)) as { decided?: boolean; allowed?: boolean; turnId?: string };
    expect(decision.decided).toBe(true);
    expect(decision.allowed).toBe(true);
    const turnId = decision.turnId;

    await fetch(`${baseUrl}/end-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "alex",
        userMessage: "Hello",
        assistantMessage: "Hi there",
        turnId,
      }),
    });
    const data = (await fetchJson("/recent-turns")) as { turns?: Array<{ user: string; assistant: string }> };
    expect(data.turns!.length).toBeGreaterThanOrEqual(1);
    const last = data.turns![data.turns!.length - 1];
    expect(last.user).toBe("Hello");
    expect(last.assistant).toBe("Hi there");
  });

  it("POST /end-turn with wrong turnId does not append (idempotent)", async () => {
    const r1 = "req-wrong-" + Date.now();
    await fetch(`${baseUrl}/request-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "alex", displayName: "Alex", transcript: "X", requestId: r1 }),
    });
    await new Promise((r) => setTimeout(r, 400));
    const decision = (await fetchJson(`/turn-decision?requestId=${r1}&agentId=alex`)) as { decided?: boolean; allowed?: boolean; turnId?: string };
    const correctTurnId = decision.turnId;
    const before = (await fetchJson("/recent-turns")) as { turns?: unknown[] };
    const countBefore = before.turns?.length ?? 0;

    await fetch(`${baseUrl}/end-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "alex",
        userMessage: "X",
        assistantMessage: "Y",
        turnId: "wrong-uuid",
      }),
    });
    const after = (await fetchJson("/recent-turns")) as { turns?: unknown[] };
    expect(after.turns?.length ?? 0).toBe(countBefore);

    // Release the turn with correct turnId so the next test can run.
    if (correctTurnId) {
      await fetch(`${baseUrl}/end-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "alex", userMessage: "X", assistantMessage: "", turnId: correctTurnId }),
      });
    }
  });

  it("POST /request-turn when currentSpeaker is set returns allowed false", async () => {
    const r1 = "req-claim-" + Date.now();
    await fetch(`${baseUrl}/request-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "alex", displayName: "Alex", transcript: "Hi", requestId: r1 }),
    });
    await new Promise((r) => setTimeout(r, 400));
    const decision = (await fetchJson(`/turn-decision?requestId=${r1}&agentId=alex`)) as { decided?: boolean; allowed?: boolean };
    expect(decision.decided).toBe(true);
    expect(decision.allowed).toBe(true);

    const res = await fetch(`${baseUrl}/request-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "jamie",
        displayName: "Jamie",
        transcript: "What do you think?",
        requestId: "req-blocked",
      }),
    });
    const data = (await res.json()) as { pending?: boolean; allowed?: boolean };
    expect(data.pending).toBe(false);
    expect(data.allowed).toBe(false);
  });
});
