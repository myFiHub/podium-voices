/**
 * Unit tests for ASR adapters (stub and factory).
 */

import { StubASR, WhisperLocalASR, createASR } from "../../../src/adapters/asr";
import type { AppConfig } from "../../../src/config";

describe("StubASR", () => {
  it("returns empty transcript", async () => {
    const asr = new StubASR();
    const result = await asr.transcribe(Buffer.alloc(100));
    expect(result.text).toBe("");
  });
});

describe("createASR", () => {
  it("returns StubASR when provider is stub", () => {
    const config: AppConfig = {
      asr: { provider: "stub" },
      llm: { provider: "stub" },
      tts: { provider: "stub" },
      podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
      pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
      agent: { personaId: "default" },
    };
    const asr = createASR(config);
    expect(asr).toBeInstanceOf(StubASR);
  });

  it("returns StubASR when provider is openai but no api key", () => {
    const config: AppConfig = {
      asr: { provider: "openai" },
      llm: { provider: "stub" },
      tts: { provider: "stub" },
      podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
      pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
      agent: { personaId: "default" },
    };
    const asr = createASR(config);
    expect(asr).toBeInstanceOf(StubASR);
  });

  it("returns WhisperLocalASR when provider is whisper-local", () => {
    const config: AppConfig = {
      asr: { provider: "whisper-local", whisperModel: "base", whisperEngine: "faster-whisper" },
      llm: { provider: "stub" },
      tts: { provider: "stub" },
      podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
      pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
      agent: { personaId: "default" },
    };
    const asr = createASR(config);
    expect(asr).toBeInstanceOf(WhisperLocalASR);
  });
});
