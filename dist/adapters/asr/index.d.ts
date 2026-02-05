/**
 * ASR adapter factory: returns implementation based on config.
 */
import type { AppConfig } from "../../config";
import type { IASR } from "./types";
export type { IASR, TranscriptResult, StreamingSession, StreamingSessionOptions, StreamingTranscriptPart } from "./types";
export { StubASR } from "./stub";
export { OpenAIWhisperASR } from "./openai-whisper";
export { WhisperLocalASR } from "./whisper-local";
export declare function createASR(config: AppConfig): IASR;
//# sourceMappingURL=index.d.ts.map