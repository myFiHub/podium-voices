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

const defaultConfig: LoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
  pretty: process.env.NODE_ENV !== "production",
};

export function createLogger(config: LoggerConfig = {}): pino.Logger {
  const opts: pino.LoggerOptions = {
    level: config.level ?? defaultConfig.level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (config.pretty ?? defaultConfig.pretty) {
    return pino({
      ...opts,
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  }
  return pino(opts);
}

export const logger = createLogger();

/** Log ASR result (avoid logging full transcript in production if PII). */
export function logAsrResult(log: pino.Logger, textLength: number, durationMs?: number): void {
  log.info({ event: "ASR_RESULT", textLength, durationMs }, "ASR completed");
}

/** Log LLM request/response (summary only). */
export function logLlmCall(log: pino.Logger, messageCount: number, responseLength: number, durationMs?: number): void {
  log.info({ event: "LLM_CALL", messageCount, responseLength, durationMs }, "LLM completed");
}

/** Log TTS call. */
export function logTtsCall(log: pino.Logger, textLength: number, audioBytes: number, durationMs?: number): void {
  log.info({ event: "TTS_CALL", textLength, audioBytes, durationMs }, "TTS completed");
}

/** Log turn start/end. */
export function logTurn(log: pino.Logger, phase: "start" | "end", turn?: string): void {
  log.info({ event: "TURN", phase, turn }, turn === "start" ? "Turn start" : "Turn end");
}

/** Log error. */
export function logError(log: pino.Logger, err: Error, context?: Record<string, unknown>): void {
  log.error({ err: err.message, stack: err.stack, ...context }, "Error");
}
