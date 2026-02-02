/**
 * Unit tests for co-host prompts.
 */

import { buildFeedbackLine, memoryToMessages, CO_HOST_SYSTEM_PROMPT } from "../../../src/prompts/co-host";
import type { SessionMemorySnapshot } from "../../../src/memory/types";

describe("buildFeedbackLine", () => {
  it("returns cheer line for cheer", () => {
    expect(buildFeedbackLine("cheer")).toContain("cheered");
  });
  it("returns boo line for boo", () => {
    expect(buildFeedbackLine("boo")).toContain("booed");
  });
  it("returns empty for neutral without lastMinute", () => {
    expect(buildFeedbackLine("neutral")).toBe("");
  });
});

describe("memoryToMessages", () => {
  it("prepends feedback and returns turns", () => {
    const snapshot: SessionMemorySnapshot = {
      turns: [
        { role: "user", content: "Hi", timestamp: 0 },
        { role: "assistant", content: "Hello", timestamp: 1 },
      ],
    };
    const msgs = memoryToMessages(snapshot, "Audience cheered.");
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0].content).toContain("Audience");
  });
});

describe("CO_HOST_SYSTEM_PROMPT", () => {
  it("contains PodiumAI and co-host", () => {
    expect(CO_HOST_SYSTEM_PROMPT).toContain("PodiumAI");
    expect(CO_HOST_SYSTEM_PROMPT).toContain("co-host");
  });
});
