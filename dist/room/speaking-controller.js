"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeakingController = void 0;
const logging_1 = require("../logging");
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
class SpeakingController {
    config;
    activeAllowedCount = 0;
    startedAtMs = null;
    forceMuted = false;
    utterances = new Map();
    constructor(config) {
        this.config = config;
    }
    begin(utteranceId, meta) {
        const now = Date.now();
        if (this.utterances.has(utteranceId))
            return;
        const gate = this.config.canSpeakNow?.();
        const allowedByTime = gate ? gate.allowed : true;
        const allowed = !this.forceMuted && allowedByTime;
        this.utterances.set(utteranceId, { allowed, source: meta?.source, startedAtMs: now });
        if (!allowed) {
            logging_1.logger.info({ event: "SPEAKING_BEGIN_DENIED", utteranceId, reason: gate?.reason ?? (this.forceMuted ? "force_muted" : "unknown"), meta }, "Speaking denied");
            return;
        }
        this.activeAllowedCount++;
        if (this.activeAllowedCount !== 1)
            return;
        this.startedAtMs = now;
        if (!this.config.wsHealthy()) {
            logging_1.logger.debug({ event: "SPEAKING_BEGIN_SKIP", reason: "ws_unhealthy", utteranceId, meta }, "Skipping start_speaking (WS unhealthy)");
            return;
        }
        logging_1.logger.debug({ event: "SPEAKING_BEGIN", outpostUuid: this.config.outpostUuid, utteranceId, meta }, "Sending start_speaking");
        this.config.startSpeaking(this.config.outpostUuid);
    }
    end(utteranceId, meta) {
        const entry = this.utterances.get(utteranceId);
        if (!entry) {
            logging_1.logger.debug({ event: "SPEAKING_END_IGNORED", reason: "unknown_utterance", utteranceId, meta }, "Ignoring speaking end");
            return;
        }
        this.utterances.delete(utteranceId);
        if (!entry.allowed)
            return;
        this.activeAllowedCount = Math.max(0, this.activeAllowedCount - 1);
        if (this.activeAllowedCount !== 0)
            return;
        const durationMs = this.startedAtMs != null ? Date.now() - this.startedAtMs : undefined;
        this.startedAtMs = null;
        if (!this.config.wsHealthy()) {
            logging_1.logger.debug({ event: "SPEAKING_END_SKIP", reason: "ws_unhealthy", durationMs, utteranceId, meta }, "Skipping stop_speaking (WS unhealthy)");
            return;
        }
        logging_1.logger.debug({ event: "SPEAKING_END", outpostUuid: this.config.outpostUuid, durationMs, utteranceId, meta }, "Sending stop_speaking");
        this.config.stopSpeaking(this.config.outpostUuid);
    }
    /** Whether audio chunks for this utterance should be sent to the room. */
    shouldPlay(utteranceId) {
        const entry = this.utterances.get(utteranceId);
        return !!entry && entry.allowed && !this.forceMuted;
    }
    /** Force mute: stop speaking immediately and deny any new utterances until cleared/restarted. */
    forceMute(reason) {
        if (this.forceMuted)
            return;
        this.forceMuted = true;
        const hadActive = this.activeAllowedCount > 0;
        this.activeAllowedCount = 0;
        this.utterances.clear();
        this.startedAtMs = null;
        if (hadActive && this.config.wsHealthy()) {
            logging_1.logger.warn({ event: "SPEAKING_FORCE_MUTE", reason }, "Force mute: sending stop_speaking");
            this.config.stopSpeaking(this.config.outpostUuid);
        }
        else {
            logging_1.logger.warn({ event: "SPEAKING_FORCE_MUTE", reason }, "Force mute");
        }
    }
    /**
     * Cancel all active utterances (e.g. barge-in) without permanently forcing mute.
     * This sends stop_speaking if we were actively speaking.
     */
    cancelAll(reason) {
        const hadActive = this.activeAllowedCount > 0;
        this.activeAllowedCount = 0;
        this.utterances.clear();
        this.startedAtMs = null;
        if (hadActive && this.config.wsHealthy()) {
            logging_1.logger.warn({ event: "SPEAKING_CANCEL_ALL", reason }, "Cancel all: sending stop_speaking");
            this.config.stopSpeaking(this.config.outpostUuid);
        }
        else {
            logging_1.logger.warn({ event: "SPEAKING_CANCEL_ALL", reason }, "Cancel all");
        }
    }
}
exports.SpeakingController = SpeakingController;
//# sourceMappingURL=speaking-controller.js.map