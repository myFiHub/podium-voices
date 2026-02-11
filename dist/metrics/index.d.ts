/**
 * High-signal metrics and watchdogs for production.
 * Counters and latencies are logged; watchdogs can trigger restarts.
 */
/** Reason the coordinator selected the winner (for multi-agent). */
export type WinnerSelectionReason = "name_addressing" | "round_robin" | "auction";
/** Last turn timing (ms). */
export interface TurnMetrics {
    asrLatencyMs?: number;
    llmLatencyMs?: number;
    ttsLatencyMs?: number;
    /** End of user speech to first bot audio (primary KPI). */
    endOfUserSpeechToBotAudioMs?: number;
    /** Bid phase duration (ms) when auction is used. */
    bidPhaseMs?: number;
    /** Why this agent won the turn (multi-agent). */
    winnerSelectionReason?: WinnerSelectionReason;
    /** Time from barge-in signal to last TTS chunk sent (ms). */
    bargeInStopLatencyMs?: number;
    /** Turn ID from coordinator for correlation. */
    turnId?: string;
    /** Request ID for correlation. */
    requestId?: string;
}
/** Audio bridge / bot stats (from browser or Node). */
export interface AudioMetrics {
    rxBytes: number;
    txBytes: number;
    jitterBufferMs?: number;
    rxRms?: number;
}
export declare function recordTurnMetrics(metrics: TurnMetrics): void;
export declare function recordAudioMetrics(metrics: Partial<AudioMetrics>): void;
export declare function getLastTurnMetrics(): TurnMetrics;
export declare function getLastAudioMetrics(): AudioMetrics;
/** Watchdog: check WS connected. Returns true if healthy. */
export type WSHealthCheck = () => boolean;
/** Watchdog: check conference/browser alive. Returns true if healthy. */
export type ConferenceHealthCheck = () => boolean;
/** Watchdog: check audio rx/tx increasing. Returns true if healthy. */
export type AudioHealthCheck = () => boolean;
export interface WatchdogConfig {
    /** Interval in ms. */
    intervalMs: number;
    /** Restart WS session if check fails this many times in a row. */
    wsFailCountBeforeRestart?: number;
    /** Restart browser/conference if check fails this many times. */
    conferenceFailCountBeforeRestart?: number;
    /** Restart audio pipeline if check fails this many times. */
    audioFailCountBeforeRestart?: number;
}
export interface WatchdogCallbacks {
    onWSUnhealthy?: () => void | Promise<void>;
    onConferenceUnhealthy?: () => void | Promise<void>;
    onAudioUnhealthy?: () => void | Promise<void>;
}
/**
 * Run one watchdog tick: run health checks and call restart callbacks if thresholds exceeded.
 */
export declare function runWatchdogTick(config: WatchdogConfig, callbacks: WatchdogCallbacks, checks: {
    ws: WSHealthCheck;
    conference?: ConferenceHealthCheck;
    audio?: AudioHealthCheck;
}): void;
//# sourceMappingURL=index.d.ts.map