/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */
import type { IASR } from "../adapters/asr";
import type { ILLM } from "../adapters/llm";
import type { ITTS } from "../adapters/tts";
import type { ISessionMemory } from "../memory/types";
import type { ICoordinatorClient } from "../coordinator/client";
import type { PipelineCallbacks } from "./types";
import { PromptManager } from "../prompts/prompt-manager";
import { SafetyGate } from "./safety";
export interface OrchestratorConfig {
    vadSilenceMs: number;
    /** Energy-based VAD threshold (when webrtcvad unavailable); lower = more sensitive. */
    vadEnergyThreshold?: number;
    /** WebRTC VAD aggressiveness 0–3 (only when webrtcvad native module is used). */
    vadAggressiveness?: number;
    /** Feedback sentiment for this turn (cheer | boo | neutral). */
    getFeedbackSentiment?: () => "cheer" | "boo" | "neutral";
    /** Threshold-derived feedback behavior level for this turn (high_positive..high_negative). */
    getFeedbackBehaviorLevel?: () => "high_positive" | "positive" | "neutral" | "negative" | "high_negative";
    /** Prompt builder; defaults to PromptManager with CO_HOST_SYSTEM_PROMPT. */
    promptManager?: PromptManager;
    /** Safety guardrails; defaults to SafetyGate. */
    safetyGate?: SafetyGate;
    /** Timeouts for external calls. */
    timeouts?: {
        asrMs?: number;
        llmMs?: number;
    };
    /** Multi-agent: Turn Coordinator client. When set, agent syncs memory and requests turn before replying. */
    coordinatorClient?: ICoordinatorClient;
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
    private speaking;
    private cancelTts;
    private pendingSegment;
    /** Log VAD_SPEECH_STARTED only once per speech run (debug). */
    private vadSpeechLogged;
    private readonly getFeedbackSentiment;
    private readonly getFeedbackBehaviorLevel;
    private readonly promptManager;
    private readonly safety;
    private readonly timeouts;
    private readonly coordinatorClient?;
    constructor(asr: IASR, llm: ILLM, tts: ITTS, memory: ISessionMemory, config: OrchestratorConfig, callbacks?: PipelineCallbacks);
    /**
     * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
     * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
     */
    pushAudio(chunk: Buffer): Promise<void>;
    private startTurn;
    private maybeRunPendingTurn;
    private runTurn;
    /**
     * Generate and speak a storyteller-style opener using the LLM (no user input required).
     * This is intended to run once after join (or on-demand).
     */
    speakOpener(args: {
        topicSeed?: string;
        outpostContext?: string;
        maxTokens?: number;
    }): Promise<void>;
    /**
     * Speak a message without user input (e.g. greeting when joining).
     * Pushes TTS to onTtsAudio and appends to memory so the LLM has context.
     */
    speakProactively(text: string): Promise<void>;
    private speakTextViaTts;
    /** Flush any buffered audio (call when stream ends). */
    flush(): void;
}
//# sourceMappingURL=orchestrator.d.ts.map