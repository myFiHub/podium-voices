/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */
import type { IASR } from "../adapters/asr";
import type { ILLM } from "../adapters/llm";
import type { ITTS } from "../adapters/tts";
import type { PersonaPlexClient } from "../adapters/personaplex";
import type { ISessionMemory } from "../memory/types";
import type { ICoordinatorClient } from "../coordinator/client";
import type { PipelineCallbacks } from "./types";
import { PromptManager } from "../prompts/prompt-manager";
import { SafetyGate } from "./safety";
import type { FillerEngineConfig } from "./fillerEngine";
export interface OrchestratorConfig {
    vadSilenceMs: number;
    /** Energy-based VAD threshold (when webrtcvad unavailable); lower = more sensitive. */
    vadEnergyThreshold?: number;
    /** WebRTC VAD aggressiveness 0–3 (only when webrtcvad native module is used). */
    vadAggressiveness?: number;
    /** Conversation backend: default ASR+LLM+TTS, or PersonaPlex speech-to-speech. */
    conversationBackendMode?: "asr-llm-tts" | "personaplex";
    /** PersonaPlex client used when conversationBackendMode === 'personaplex'. */
    personaplexClient?: PersonaPlexClient;
    /** If true, fall back to ASR+LLM+TTS when PersonaPlex fails. */
    personaplexFallbackToLlm?: boolean;
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
    /** Optional filler engine config for latency masking (play short clip before main reply). */
    fillerConfig?: FillerEngineConfig;
    /** Persona ID for filler selection (e.g. "default", "hype", "orator"). */
    personaId?: string;
    /** When set, TTS uses this cadence profile (personas/*.json) for rate/pitch. Typically same as personaId for cadence personas. */
    cadenceProfileId?: string;
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
    /** When barge-in was signaled (for bargeInStopLatencyMs). */
    private bargeInAt;
    private pendingSegment;
    private activeStreamingSession;
    /** Set when ASR emits end_of_turn_predicted so VAD path skips this segment. */
    private turnHandledByAsrEvent;
    /** Log VAD_SPEECH_STARTED only once per speech run (debug). */
    private vadSpeechLogged;
    private readonly getFeedbackSentiment;
    private readonly getFeedbackBehaviorLevel;
    private readonly promptManager;
    private readonly safety;
    private readonly timeouts;
    private readonly coordinatorClient?;
    private readonly backendMode;
    private readonly personaplexClient?;
    private readonly personaplexFallbackToLlm;
    private readonly fillerConfig?;
    private readonly personaId;
    private readonly cadenceProfileId?;
    /** Set when main TTS starts so filler playback aborts. */
    private fillerAbort;
    constructor(asr: IASR, llm: ILLM, tts: ITTS, memory: ISessionMemory, config: OrchestratorConfig, callbacks?: PipelineCallbacks);
    /** Voice options for TTS: sample rate, rate/pitch, and optional voice name from cadence profile when set. */
    private getVoiceOptionsForTts;
    /** Capture barge-in stop latency (ms) and clear; call when recording turn metrics. */
    private captureBargeInLatency;
    /**
     * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
     * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
     */
    pushAudio(chunk: Buffer): Promise<void>;
    /** Finalize streaming ASR session and run turn (called when adapter emits end_of_turn_predicted). */
    private finalizeStreamingSessionAndTurn;
    private startTurn;
    private startTurnFromTranscript;
    private maybeRunPendingTurn;
    private runTurn;
    private runTurnPersonaPlex;
    private runTurnCore;
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