/**
 * ASR adapter factory: returns implementation based on config.
 */

import type { AppConfig } from "../../config";
import type { IASR } from "./types";
import { StubASR } from "./stub";
import { OpenAIWhisperASR } from "./openai-whisper";

export type { IASR, TranscriptResult } from "./types";
export { StubASR } from "./stub";
export { OpenAIWhisperASR } from "./openai-whisper";

export function createASR(config: AppConfig): IASR {
  const { provider, openaiApiKey } = config.asr;
  if (provider === "openai" && openaiApiKey) {
    return new OpenAIWhisperASR({ apiKey: openaiApiKey });
  }
  return new StubASR();
}
