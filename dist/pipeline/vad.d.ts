/**
 * Voice Activity Detection: detect speech vs silence on 16kHz mono 16-bit frames.
 * Uses webrtcvad (npm 1.0.1) when available; falls back to energy-based VAD if native module fails to load.
 */
export interface VADConfig {
    /** Silence duration (ms) to consider end of turn. */
    silenceMs: number;
    /** Aggressiveness 0-3 (webrtcvad only; 0 = least aggressive, 3 = most). */
    aggressiveness?: number;
}
export interface VADResult {
    /** True if speech detected in this frame. */
    isSpeech: boolean;
    /** True when silence has lasted >= silenceMs after speech. */
    endOfTurn: boolean;
    /** Accumulated segment (all frames since last segment start) when endOfTurn. */
    segment: Buffer | undefined;
}
export declare class VAD {
    private vad;
    private readonly silenceFrames;
    private readonly aggressiveness;
    private buffer;
    private silenceCount;
    private hadSpeech;
    constructor(config: VADConfig);
    private isVoice;
    /**
     * Process one frame of audio (16kHz mono 16-bit, 20ms = 640 bytes).
     * Returns VAD result; when endOfTurn, segment contains the accumulated speech.
     */
    processFrame(frame: Buffer): VADResult;
    /**
     * Process arbitrary-length buffer; returns array of full frames processed and optional final segment.
     * Caller should pass 16kHz mono 16-bit PCM.
     */
    processBuffer(audio: Buffer): {
        framesProcessed: number;
        segment: Buffer | undefined;
    };
    static getFrameSizeBytes(): number;
    static getSampleRate(): number;
}
//# sourceMappingURL=vad.d.ts.map