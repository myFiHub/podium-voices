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

  it("POST /end-turn appends turn and GET /recent-turns returns it", async () => {
    await fetch(`${baseUrl}/end-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "alex",
        userMessage: "Hello",
        assistantMessage: "Hi there",
      }),
    });
    const data = (await fetchJson("/recent-turns")) as { turns?: Array<{ user: string; assistant: string }> };
    expect(data.turns).toHaveLength(1);
    expect(data.turns![0].user).toBe("Hello");
    expect(data.turns![0].assistant).toBe("Hi there");
  });

  it("POST /request-turn when currentSpeaker is set returns allowed false", async () => {
    const r1 = "req-claim";
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
