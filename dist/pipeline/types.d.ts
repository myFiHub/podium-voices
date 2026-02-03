/**
 * Pipeline types: audio chunks, turn events, and callbacks.
 */
export interface AudioChunk {
    /** Raw PCM 16-bit mono. */
    buffer: Buffer;
    /** Sample rate in Hz (e.g. 16000 for VAD). */
    sampleRate: number;
    /** Optional timestamp (ms). */
    timestamp?: number;
}
export interface TurnDecision {
    /** True when end of user turn detected (silence after speech). */
    endOfTurn: boolean;
    /** Accumulated speech segment to send to ASR (when endOfTurn). */
    segment?: Buffer;
}
export interface PipelineCallbacks {
    /** Called when TTS audio is ready (stream or single buffer). */
    onTtsAudio?(buffer: Buffer, meta?: {
        utteranceId: string;
        source: "turn" | "proactive" | "opener";
    }): void;
    /** Called when a TTS utterance starts (first non-empty audio chunk). */
    onTtsStart?(meta: {
        utteranceId: string;
        source: "turn" | "proactive" | "opener";
        textLength?: number;
    }): void;
    /** Called when a TTS utterance ends (after the last audio chunk). */
    onTtsEnd?(meta: {
        utteranceId: string;
        source: "turn" | "proactive" | "opener";
    }): void;
    /** Called when user speech is detected while the bot is speaking (barge-in). */
    onBargeIn?(meta: {
        reason: "user_speech";
    }): void;
    /** Called when a full agent reply text is known (for logging). */
    onAgentReply?(text: string): void;
    /** Called when user transcript is known (for logging). */
    onUserTranscript?(text: string): void;
}
//# sourceMappingURL=types.d.ts.map