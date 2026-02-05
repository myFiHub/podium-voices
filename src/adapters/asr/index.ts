/**
 * ASR adapter factory: returns implementation based on config.
 */

import type { AppConfig } from "../../config";
import type { IASR } from "./types";
import { StubASR } from "./stub";
import { OpenAIWhisperASR } from "./openai-whisper";
import { WhisperLocalASR } from "./whisper-local";

export type { IASR, TranscriptResult, StreamingSession, StreamingSessionOptions, StreamingTranscriptPart } from "./types";
export { StubASR } from "./stub";
export { OpenAIWhisperASR } from "./openai-whisper";
export { WhisperLocalASR } from "./whisper-local";

export function createASR(config: AppConfig): IASR {
  const { provider, openaiApiKey, whisperModel, whisperEngine, whisperPythonPath } = config.asr;
  if (provider === "openai" && openaiApiKey) {
    return new OpenAIWhisperASR({ apiKey: openaiApiKey });
  }
  if (provider === "whisper-local") {
    return new WhisperLocalASR({
      model: whisperModel || "base",
      engine: whisperEngine || "faster-whisper",
      pythonPath: whisperPythonPath,
    });
  }
  return new StubASR();
}
