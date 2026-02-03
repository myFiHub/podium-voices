import { SpeakingController } from "../../../src/room/speaking-controller";

describe("SpeakingController", () => {
  it("sends start once and stop once across overlapping utterances", () => {
    const calls: string[] = [];
    const sc = new SpeakingController({
      outpostUuid: "outpost-1",
      wsHealthy: () => true,
      startSpeaking: () => calls.push("start"),
      stopSpeaking: () => calls.push("stop"),
    });

    sc.begin("u1");
    sc.begin("u2");
    sc.end("u1");
    // still active
    sc.end("u2");

    expect(calls).toEqual(["start", "stop"]);
  });

  it("denies speaking when canSpeakNow is false", () => {
    const calls: string[] = [];
    const sc = new SpeakingController({
      outpostUuid: "outpost-1",
      wsHealthy: () => true,
      canSpeakNow: () => ({ allowed: false, reason: "time_is_up" }),
      startSpeaking: () => calls.push("start"),
      stopSpeaking: () => calls.push("stop"),
    });

    sc.begin("u1");
    expect(calls).toEqual([]);
    expect(sc.shouldPlay("u1")).toBe(false);
  });
});

