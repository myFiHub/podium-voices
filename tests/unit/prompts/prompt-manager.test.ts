import { PromptManager } from "../../../src/prompts/prompt-manager";
import type { SessionMemorySnapshot } from "../../../src/memory/types";

describe("PromptManager", () => {
  const emptySnapshot: SessionMemorySnapshot = { turns: [] };

  it("builds opener messages with a topic seed", () => {
    const pm = new PromptManager();
    const msgs = pm.buildMessages({
      mode: "opener",
      snapshot: emptySnapshot,
      sentiment: "neutral",
      topicSeed: "ancient myths",
      outpostContext: "Subject: Legends",
    });
    expect(msgs[0].role).toBe("system");
    expect(msgs.some((m) => m.role === "user" && m.content.includes("Topic seed"))).toBe(true);
  });

  it("builds reply messages with system prompt", () => {
    const pm = new PromptManager();
    const msgs = pm.buildMessages({
      mode: "reply",
      snapshot: { turns: [{ role: "user", content: "Hi", timestamp: 0 }] },
      sentiment: "neutral",
      behaviorLevel: "neutral",
    });
    expect(msgs[0].role).toBe("system");
    expect(msgs.some((m) => m.content.includes("Hi"))).toBe(true);
  });

  it("accepts a custom feedbackContextBuilder", () => {
    const pm = new PromptManager({
      feedbackContextBuilder: () => "Audience feedback: CUSTOM",
    });
    const msgs = pm.buildMessages({
      mode: "reply",
      snapshot: emptySnapshot,
      sentiment: "neutral",
      behaviorLevel: "high_positive",
    });
    expect(msgs.some((m) => m.role === "user" && m.content.includes("CUSTOM"))).toBe(true);
  });
});

