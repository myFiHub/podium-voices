/**
 * Unit tests for coordinator auction (runAward, normalizeBid).
 */

import { normalizeBid, runAward } from "../../../src/coordinator/auction";

describe("normalizeBid", () => {
  it("returns default bid when input is null/undefined", () => {
    expect(normalizeBid(null)).toEqual({ score: 5, intent: "answer", confidence: 0.5, target: null });
    expect(normalizeBid(undefined)).toEqual({ score: 5, intent: "answer", confidence: 0.5, target: null });
  });

  it("clamps score to 0-10", () => {
    expect(normalizeBid({ score: 15 }).score).toBe(10);
    expect(normalizeBid({ score: -1 }).score).toBe(0);
    expect(normalizeBid({ score: 7 }).score).toBe(7);
  });

  it("uses valid intent or default", () => {
    expect(normalizeBid({ intent: "hype" }).intent).toBe("hype");
    expect(normalizeBid({ intent: "invalid" }).intent).toBe("answer");
  });

  it("trims target", () => {
    expect(normalizeBid({ target: " alex " }).target).toBe("alex");
    expect(normalizeBid({ target: "" }).target).toBe(null);
  });
});

describe("runAward", () => {
  const order = ["alex", "jamie"];

  it("throws when no entries", () => {
    expect(() => runAward([], "hello", null, order)).toThrow("no entries");
  });

  it("returns name_addressing when transcript contains display name", () => {
    const entries = [
      { agentId: "alex", displayName: "Alex" },
      { agentId: "jamie", displayName: "Jamie" },
    ];
    const r = runAward(entries, "alex what do you think?", null, order);
    expect(r.winnerId).toBe("alex");
    expect(r.reason).toBe("name_addressing");
  });

  it("returns highest score when no name in transcript", () => {
    const entries = [
      { agentId: "alex", displayName: "Alex", bid: { score: 3, intent: "answer", confidence: 0.5, target: null } },
      { agentId: "jamie", displayName: "Jamie", bid: { score: 8, intent: "answer", confidence: 0.5, target: null } },
    ];
    const r = runAward(entries, "hello there", null, order);
    expect(r.winnerId).toBe("jamie");
    expect(r.reason).toBe("auction");
  });

  it("tie-breaks by agent order", () => {
    const entries = [
      { agentId: "jamie", displayName: "Jamie", bid: { score: 5, intent: "answer", confidence: 0.5, target: null } },
      { agentId: "alex", displayName: "Alex", bid: { score: 5, intent: "answer", confidence: 0.5, target: null } },
    ];
    const r = runAward(entries, "hello", null, order);
    expect(r.winnerId).toBe("alex");
    expect(r.reason).toBe("auction");
  });

  it("returns round_robin when no bids", () => {
    const entries = [
      { agentId: "alex", displayName: "Alex" },
      { agentId: "jamie", displayName: "Jamie" },
    ];
    const r = runAward(entries, "hello", null, order);
    expect(["alex", "jamie"]).toContain(r.winnerId);
    expect(r.reason).toBe("round_robin");
  });
});
