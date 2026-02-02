/**
 * High-signal metrics and watchdogs for production.
 * Counters and latencies are logged; watchdogs can trigger restarts.
 */
/** Last turn timing (ms). */
export interface TurnMetrics {
    asrLatencyMs?: number;
    llmLatencyMs?: number;
    ttsLatencyMs?: number;
    /** End of user speech to first bot audio (primary KPI). */
    endOfUserSpeechToBotAudioMs?: number;
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