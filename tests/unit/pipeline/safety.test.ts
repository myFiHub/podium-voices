import { SafetyGate } from "../../../src/pipeline/safety";

describe("SafetyGate", () => {
  it("truncates long assistant replies", () => {
    const sg = new SafetyGate({ maxAssistantChars: 10 });
    const res = sg.sanitizeAssistantReply("0123456789abcdef");
    expect(res.allowed).toBe(true);
    expect(res.text.length).toBe(10);
  });

  it("reframes profanity in assistant replies", () => {
    const sg = new SafetyGate();
    const res = sg.sanitizeAssistantReply("this is shit");
    expect(res.allowed).toBe(true);
    expect(res.text).toContain("friendly");
  });
});

