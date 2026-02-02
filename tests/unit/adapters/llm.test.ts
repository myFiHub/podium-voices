/**
 * Unit tests for LLM adapters (stub and factory).
 */

import { StubLLM, createLLM } from "../../../src/adapters/llm";
import type { AppConfig } from "../../../src/config";

describe("StubLLM", () => {
  it("returns empty response", async () => {
    const llm = new StubLLM();
    const result = await llm.chat([{ role: "user", content: "Hello" }]);
    expect(result.text).toBe("");
  });
});

describe("createLLM", () => {
  it("returns StubLLM when provider is stub", () => {
    const config: AppConfig = {
      asr: { provider: "stub" },
      llm: { provider: "stub" },
      tts: { provider: "stub" },
      podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
      pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
    };
    const llm = createLLM(config);
    expect(llm).toBeInstanceOf(StubLLM);
  });
});
