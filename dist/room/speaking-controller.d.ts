export interface SpeakingControllerConfig {
    /** Outpost UUID to include in WS speaking messages. */
    outpostUuid: string;
    /** Returns true if the Podium WS is healthy enough to send. */
    wsHealthy: () => boolean;
    /** Optional speaking-time gate (non-creator must have remaining_time > 0). */
    canSpeakNow?: () => {
        allowed: boolean;
        reason?: string;
    };
    /** Send start_speaking (Podium layer). */
    startSpeaking: (outpostUuid: string) => void;
    /** Send stop_speaking (Podium layer). */
    stopSpeaking: (outpostUuid: string) => void;
}
/**
 * SpeakingController
 *
 * Owns the *Podium speaking state* transitions (start_speaking/stop_speaking).
 * This is intentionally separate from audio transport: the audio can still play even if WS is down,
 * but we avoid spamming start/stop when WS is unhealthy.
 *
 * It is also overlap-safe: if multiple utterances overlap (e.g. proactive greeting + reply),
 * it uses a refcount and only emits stop_speaking when all active utterances have ended.
 */
export declare class SpeakingController {
    private readonly config;
    private activeAllowedCount;
    private startedAtMs;
    private forceMuted;
    private utterances;
    constructor(config: SpeakingControllerConfig);
    begin(utteranceId: string, meta?: {
        source?: string;
    }): void;
    end(utteranceId: string, meta?: {
        source?: string;
    }): void;
    /** Whether audio chunks for this utterance should be sent to the room. */
    shouldPlay(utteranceId: string): boolean;
    /** Force mute: stop speaking immediately and deny any new utterances until cleared/restarted. */
    forceMute(reason: string): void;
    /**
     * Cancel all active utterances (e.g. barge-in) without permanently forcing mute.
     * This sends stop_speaking if we were actively speaking.
     */
    cancelAll(reason: string): void;
}
//# sourceMappingURL=speaking-controller.d.ts.map