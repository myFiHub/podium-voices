"use strict";
/**
 * Structured logging for the AI co-host pipeline.
 * Logs ASR, LLM, TTS, turn events, and errors with timestamps. JSON output for shipping.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
exports.logAsrResult = logAsrResult;
exports.logLlmCall = logLlmCall;
exports.logTtsCall = logTtsCall;
exports.logTurn = logTurn;
exports.logError = logError;
const pino_1 = __importDefault(require("pino"));
const defaultConfig = {
    level: process.env.LOG_LEVEL ?? "info",
    pretty: process.env.NODE_ENV !== "production",
};
function createLogger(config = {}) {
    const opts = {
        level: config.level ?? defaultConfig.level,
        base: undefined,
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
    };
    if (config.pretty ?? defaultConfig.pretty) {
        return (0, pino_1.default)({
            ...opts,
            transport: { target: "pino-pretty", options: { colorize: true } },
        });
    }
    return (0, pino_1.default)(opts);
}
exports.logger = createLogger();
/** Log ASR result (avoid logging full transcript in production if PII). */
function logAsrResult(log, textLength, durationMs) {
    log.info({ event: "ASR_RESULT", textLength, durationMs }, "ASR completed");
}
/** Log LLM request/response (summary only). */
function logLlmCall(log, messageCount, responseLength, durationMs) {
    log.info({ event: "LLM_CALL", messageCount, responseLength, durationMs }, "LLM completed");
}
/** Log TTS call. */
function logTtsCall(log, textLength, audioBytes, durationMs) {
    log.info({ event: "TTS_CALL", textLength, audioBytes, durationMs }, "TTS completed");
}
/** Log turn start/end. */
function logTurn(log, phase, turn) {
    log.info({ event: "TURN", phase, turn }, turn === "start" ? "Turn start" : "Turn end");
}
/** Log error. */
function logError(log, err, context) {
    log.error({ err: err.message, stack: err.stack, ...context }, "Error");
}
//# sourceMappingURL=index.js.map