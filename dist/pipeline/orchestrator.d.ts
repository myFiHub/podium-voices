/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */
import type { IASR } from "../adapters/asr";
import type { ILLM } from "../adapters/llm";
import type { ITTS } from "../adapters/tts";
import type { ISessionMemory } from "../memory/types";
import type { PipelineCallbacks } from "./types";
export interface OrchestratorConfig {
    vadSilenceMs: number;
    /** Feedback sentiment for this turn (cheer | boo | neutral). */
    getFeedbackSentiment?: () => "cheer" | "boo" | "neutral";
}
export declare class Orchestrator {
    private readonly asr;
    private readonly llm;
    private readonly tts;
    private readonly memory;
    private readonly config;
    private readonly callbacks;
    private vad;
    private audioBuffer;
    private processing;
    private readonly getFeedbackSentiment;
    constructor(asr: IASR, llm: ILLM, tts: ITTS, memory: ISessionMemory, config: OrchestratorConfig, callbacks?: PipelineCallbacks);
    /**
     * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
     * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
     */
    pushAudio(chunk: Buffer): Promise<void>;
    private runTurn;
    /** Flush any buffered audio (call when stream ends). */
    flush(): void;
}
//# sourceMappingURL=orchestrator.d.ts.map