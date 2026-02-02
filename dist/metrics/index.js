"use strict";
/**
 * High-signal metrics and watchdogs for production.
 * Counters and latencies are logged; watchdogs can trigger restarts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordTurnMetrics = recordTurnMetrics;
exports.recordAudioMetrics = recordAudioMetrics;
exports.getLastTurnMetrics = getLastTurnMetrics;
exports.getLastAudioMetrics = getLastAudioMetrics;
exports.runWatchdogTick = runWatchdogTick;
const logging_1 = require("../logging");
let lastTurnMetrics = {};
let lastAudioMetrics = { rxBytes: 0, txBytes: 0 };
function recordTurnMetrics(metrics) {
    lastTurnMetrics = { ...lastTurnMetrics, ...metrics };
    logging_1.logger.info({
        event: "TURN_METRICS",
        asr_latency_ms: metrics.asrLatencyMs,
        llm_latency_ms: metrics.llmLatencyMs,
        tts_latency_ms: metrics.ttsLatencyMs,
        end_of_user_speech_to_bot_audio_ms: metrics.endOfUserSpeechToBotAudioMs,
    }, "Turn latency");
}
function recordAudioMetrics(metrics) {
    if (metrics.rxBytes !== undefined)
        lastAudioMetrics.rxBytes = metrics.rxBytes;
    if (metrics.txBytes !== undefined)
        lastAudioMetrics.txBytes = metrics.txBytes;
    if (metrics.jitterBufferMs !== undefined)
        lastAudioMetrics.jitterBufferMs = metrics.jitterBufferMs;
    if (metrics.rxRms !== undefined)
        lastAudioMetrics.rxRms = metrics.rxRms;
}
function getLastTurnMetrics() {
    return { ...lastTurnMetrics };
}
function getLastAudioMetrics() {
    return { ...lastAudioMetrics };
}
let wsFailCount = 0;
let conferenceFailCount = 0;
let audioFailCount = 0;
/**
 * Run one watchdog tick: run health checks and call restart callbacks if thresholds exceeded.
 */
function runWatchdogTick(config, callbacks, checks) {
    const wsOk = checks.ws();
    if (!wsOk) {
        wsFailCount++;
        if (config.wsFailCountBeforeRestart != null && wsFailCount >= config.wsFailCountBeforeRestart) {
            logging_1.logger.warn({ event: "WATCHDOG_WS_UNHEALTHY", failCount: wsFailCount }, "WS unhealthy; triggering restart");
            wsFailCount = 0;
            void Promise.resolve(callbacks.onWSUnhealthy?.()).catch((e) => logging_1.logger.warn({ err: e }, "onWSUnhealthy error"));
        }
    }
    else {
        wsFailCount = 0;
    }
    if (checks.conference) {
        const confOk = checks.conference();
        if (!confOk) {
            conferenceFailCount++;
            if (config.conferenceFailCountBeforeRestart != null && conferenceFailCount >= config.conferenceFailCountBeforeRestart) {
                logging_1.logger.warn({ event: "WATCHDOG_CONFERENCE_UNHEALTHY", failCount: conferenceFailCount }, "Conference unhealthy; triggering restart");
                conferenceFailCount = 0;
                void Promise.resolve(callbacks.onConferenceUnhealthy?.()).catch((e) => logging_1.logger.warn({ err: e }, "onConferenceUnhealthy error"));
            }
        }
        else {
            conferenceFailCount = 0;
        }
    }
    if (checks.audio) {
        const audioOk = checks.audio();
        if (!audioOk) {
            audioFailCount++;
            if (config.audioFailCountBeforeRestart != null && audioFailCount >= config.audioFailCountBeforeRestart) {
                logging_1.logger.warn({ event: "WATCHDOG_AUDIO_UNHEALTHY", failCount: audioFailCount }, "Audio unhealthy; triggering restart");
                audioFailCount = 0;
                void Promise.resolve(callbacks.onAudioUnhealthy?.()).catch((e) => logging_1.logger.warn({ err: e }, "onAudioUnhealthy error"));
            }
        }
        else {
            audioFailCount = 0;
        }
    }
}
//# sourceMappingURL=index.js.map