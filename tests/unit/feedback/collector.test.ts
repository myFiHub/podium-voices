/**
 * Unit tests for feedback collector.
 */

import { FeedbackCollector } from "../../../src/feedback/collector";
import { WS_INCOMING_NAMES } from "../../../src/room/types";

describe("FeedbackCollector", () => {
  it("increments counts for Podium/nexus reaction WS events", () => {
    const c = new FeedbackCollector({ windowMs: 60_000 });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_CHEERED, data: { react_to_user_address: "0xabc" } });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_BOOED, data: { react_to_user_address: "0xabc" } });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_LIKED, data: { react_to_user_address: "0xabc" } });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_DISLIKED, data: { react_to_user_address: "0xabc" } });

    const s = c.getState();
    expect(s.cheers).toBe(1);
    expect(s.boos).toBe(1);
    expect(s.likes).toBe(1);
    expect(s.dislikes).toBe(1);
    expect(s.cheerAmount).toBe(0);
    expect(s.booAmount).toBe(0);
  });

  it("supports react_to_user_address filtering (case-insensitive)", () => {
    const c = new FeedbackCollector({ windowMs: 60_000, reactToUserAddressFilter: "0xDeAdBeEf" });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_CHEERED, data: { react_to_user_address: "0xdeadbeef" } });
    c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_CHEERED, data: { react_to_user_address: "0xOTHER" } });

    const s = c.getState();
    expect(s.cheers).toBe(1);
  });

  it("accumulates reaction amount for cheer/boo when present", () => {
    const c = new FeedbackCollector({ windowMs: 60_000 });
    c.handleWSMessage({
      name: WS_INCOMING_NAMES.USER_CHEERED,
      data: { react_to_user_address: "0xabc", amount: 1.5 },
    });
    c.handleWSMessage({
      name: WS_INCOMING_NAMES.USER_BOOED,
      data: { react_to_user_address: "0xabc", amount: 2 },
    });

    const s = c.getState();
    expect(s.cheers).toBe(1);
    expect(s.boos).toBe(1);
    expect(s.cheerAmount).toBeCloseTo(1.5);
    expect(s.booAmount).toBeCloseTo(2);
  });

  it("derives behavior level via thresholds (negative-biased)", () => {
    const c = new FeedbackCollector({ windowMs: 60_000 });
    // Add both high-positive and high-negative signals; high-negative should win.
    for (let i = 0; i < 5; i++) {
      c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_CHEERED, data: { react_to_user_address: "0xabc" } });
    }
    for (let i = 0; i < 3; i++) {
      c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_BOOED, data: { react_to_user_address: "0xabc" } });
    }

    const level = c.getBehaviorLevel({
      highPositive: { minCheers: 5 },
      positive: { minCheers: 2 },
      negative: { minBoos: 2 },
      highNegative: { minBoos: 3 },
    });
    expect(level).toBe("high_negative");
  });

  it("prefers negative over high_positive when both match (de-escalation bias)", () => {
    const c = new FeedbackCollector({ windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_CHEERED, data: { react_to_user_address: "0xabc" } });
    }
    for (let i = 0; i < 2; i++) {
      c.handleWSMessage({ name: WS_INCOMING_NAMES.USER_BOOED, data: { react_to_user_address: "0xabc" } });
    }

    const level = c.getBehaviorLevel({
      highPositive: { minCheers: 5 },
      positive: { minCheers: 2 },
      negative: { minBoos: 2 },
      highNegative: { minBoos: 99 },
    });
    expect(level).toBe("negative");
  });
});

