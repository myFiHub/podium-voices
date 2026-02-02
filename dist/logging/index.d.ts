/**
 * Structured logging for the AI co-host pipeline.
 * Logs ASR, LLM, TTS, turn events, and errors with timestamps. JSON output for shipping.
 */
import pino from "pino";
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LoggerConfig {
    level?: LogLevel;
    pretty?: boolean;
}
export declare function createLogger(config?: LoggerConfig): pino.Logger;
export declare const logger: pino.Logger<never, boolean>;
/** Log ASR result (avoid logging full transcript in production if PII). */
export declare function logAsrResult(log: pino.Logger, textLength: number, durationMs?: number): void;
/** Log LLM request/response (summary only). */
export declare function logLlmCall(log: pino.Logger, messageCount: number, responseLength: number, durationMs?: number): void;
/** Log TTS call. */
export declare function logTtsCall(log: pino.Logger, textLength: number, audioBytes: number, durationMs?: number): void;
/** Log turn start/end. */
export declare function logTurn(log: pino.Logger, phase: "start" | "end", turn?: string): void;
/** Log error. */
export declare function logError(log: pino.Logger, err: Error, context?: Record<string, unknown>): void;
//# sourceMappingURL=index.d.ts.map