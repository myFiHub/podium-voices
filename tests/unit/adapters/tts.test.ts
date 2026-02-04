/**
 * Unit tests for TTS adapters (stub, ttsToStream, factory).
 */

import { StubTTS, createTTS, ttsToStream } from "../../../src/adapters/tts";
import type { AppConfig } from "../../../src/config";

describe("StubTTS", () => {
  it("returns empty buffer", async () => {
    const tts = new StubTTS();
    const result = await tts.synthesize("Hello");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).length).toBe(0);
  });
});

describe("ttsToStream", () => {
  it("yields single buffer from Promise<Buffer>", async () => {
    const buf = Buffer.from("abc");
    const chunks: Buffer[] = [];
    for await (const c of ttsToStream(Promise.resolve(buf))) {
      chunks.push(c);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].equals(buf)).toBe(true);
  });
});

describe("createTTS", () => {
  it("returns StubTTS when provider is stub", () => {
    const config: AppConfig = {
      asr: { provider: "stub" },
      llm: { provider: "stub" },
      tts: { provider: "stub" },
      podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
      pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
      agent: { personaId: "default" },
    };
    const tts = createTTS(config);
    expect(tts).toBeInstanceOf(StubTTS);
  });
});
