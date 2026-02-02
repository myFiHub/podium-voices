/**
 * OpenAI Whisper API ASR adapter.
 */
import type { IASR, TranscriptResult } from "./types";
export interface OpenAIWhisperConfig {
    apiKey: string;
}
export declare class OpenAIWhisperASR implements IASR {
    private readonly config;
    private client;
    constructor(config: OpenAIWhisperConfig);
    transcribe(audioBuffer: Buffer, format?: string): Promise<TranscriptResult>;
}
//# sourceMappingURL=openai-whisper.d.ts.map