"use strict";
/**
 * High-level Podium room client: runs host join flow and exposes audio in/out.
 * Uses REST (api), WebSocket (ws), and Jitsi (jitsi) to join as host; then provides
 * incoming audio stream for the pipeline and a method to push TTS output.
 * Implements WS reconnect with exponential backoff + jitter; Jitsi start with retry.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = void 0;
const api_1 = require("./api");
const ws_1 = require("./ws");
const jitsi_1 = require("./jitsi");
const vad_1 = require("../pipeline/vad");
const logging_1 = require("../logging");
const JITSI_START_ATTEMPTS = 3;
const JITSI_START_DELAY_MS_MIN = 2000;
const JITSI_START_DELAY_MS_MAX = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;
const RECONNECT_CAP = 60_000;
function jitter(minMs, maxMs) {
    return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}
function backoffDelay(attempt) {
    const exp = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
    const withJitter = Math.floor(exp * (0.8 + Math.random() * 0.4));
    return Math.min(withJitter, RECONNECT_CAP);
}
class RoomClient {
    api;
    ws;
    jitsi = null;
    user = null;
    outpost = null;
    config;
    callbacks = {};
    reconnectAttempts = 0;
    reconnectTimer = null;
    isLeaving = false;
    constructor(config) {
        this.config = config;
        this.api = new api_1.PodiumApi({ baseUrl: config.apiUrl, token: config.token });
        this.ws = new ws_1.PodiumWS({
            wsAddress: config.wsAddress,
            token: config.token,
        });
        this.ws.setOnDisconnected(() => this.scheduleReconnect());
    }
    scheduleReconnect() {
        if (this.isLeaving || !this.user || !this.outpost)
            return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const delayMs = backoffDelay(this.reconnectAttempts);
        this.reconnectAttempts++;
        logging_1.logger.info({ event: "WS_RECONNECT_SCHEDULED", delayMs, attempt: this.reconnectAttempts }, "WebSocket disconnected; scheduling reconnect");
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.doReconnect().catch((err) => {
                logging_1.logger.warn({ event: "WS_RECONNECT_FAILED", err: err.message }, "Reconnect failed; will retry on next disconnect or watchdog");
            });
        }, delayMs);
    }
    async doReconnect() {
        if (!this.user || !this.outpost)
            return;
        this.ws.disconnect();
        await this.ws.connect();
        await this.api.addMeAsMember(this.config.outpostUuid);
        await this.ws.joinOutpost(this.config.outpostUuid, this.user.address, {
            myUuid: this.user.uuid,
            timeoutMs: 15000,
        });
        this.reconnectAttempts = 0;
        logging_1.logger.info({ event: "WS_RECONNECTED" }, "WebSocket reconnected and re-joined outpost");
    }
    onAudioChunk(cb) {
        this.callbacks.onAudioChunk = cb;
    }
    /** Subscribe to raw Podium WS messages (reactions, speaking-time events, etc.). */
    onWSMessage(cb) {
        this.ws.onMessage(cb);
    }
    /** Fetch latest live data snapshot (members + remaining_time). Call only after successful WS join. */
    async getLatestLiveData() {
        return this.api.getLatestLiveData(this.config.outpostUuid);
    }
    /** Run full host join flow. Returns when joined (WS + optional Jitsi). */
    async join() {
        this.user = await this.api.getProfile();
        this.outpost = await this.api.getOutpost(this.config.outpostUuid);
        // Join permission is enforced by the Podium API/WS; addMeAsMember and joinOutpost will fail if the user is not allowed.
        await this.ws.connect();
        await this.api.addMeAsMember(this.config.outpostUuid);
        await this.ws.joinOutpost(this.config.outpostUuid, this.user.address, {
            myUuid: this.user.uuid,
            timeoutMs: 15000,
        });
        if (this.outpost.creator_user_uuid === this.user.uuid) {
            await this.api.setCreatorJoinedToTrue(this.config.outpostUuid);
        }
        // Jitsi expects hostname only (no protocol). outpost_host_url may be "https://outposts.example.com".
        const rawDomain = this.outpost.outpost_host_url ?? this.config.outpostServer;
        const domain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || rawDomain;
        this.jitsi = (0, jitsi_1.createJitsiRoom)({
            domain,
            xmppDomain: this.config.jitsiXmppDomain,
            mucDomain: this.config.jitsiMucDomain,
            roomName: this.config.outpostUuid,
            user: this.user,
            creatorUuid: this.outpost.creator_user_uuid,
            cohostUuids: this.outpost.cohost_user_uuids ?? [],
            useJitsiBot: this.config.useJitsiBot,
            botPageUrl: this.config.botPageUrl,
            jwt: this.config.jitsiJwt,
            bridgePort: this.config.jitsiBridgePort,
        });
        this.jitsi.onIncomingAudio((buffer, sampleRate) => {
            if (sampleRate !== vad_1.VAD.getSampleRate()) {
                // Resample or document that we expect 16kHz; for MVP pass through and let VAD handle
                this.callbacks.onAudioChunk?.(buffer);
            }
            else {
                this.callbacks.onAudioChunk?.(buffer);
            }
        });
        if (typeof this.jitsi.start === "function") {
            let lastErr = null;
            for (let attempt = 1; attempt <= JITSI_START_ATTEMPTS; attempt++) {
                try {
                    await this.jitsi.start();
                    lastErr = null;
                    break;
                }
                catch (err) {
                    lastErr = err instanceof Error ? err : new Error(String(err));
                    logging_1.logger.warn({ event: "JITSI_START_FAILED", attempt, maxAttempts: JITSI_START_ATTEMPTS, err: lastErr.message }, "Jitsi start failed; retrying");
                    if (attempt < JITSI_START_ATTEMPTS) {
                        const delay = jitter(JITSI_START_DELAY_MS_MIN, JITSI_START_DELAY_MS_MAX);
                        await new Promise((r) => setTimeout(r, delay));
                    }
                }
            }
            if (lastErr) {
                throw lastErr;
            }
        }
        return { user: this.user, outpost: this.outpost };
    }
    /** Push TTS audio to the room (PCM 16-bit mono). */
    pushTtsAudio(buffer) {
        this.jitsi?.pushAudio(buffer);
    }
    /** Podium WS: indicate bot started speaking (UI state). */
    startSpeaking() {
        this.ws.startSpeaking(this.config.outpostUuid);
    }
    /** Podium WS: indicate bot stopped speaking (UI state). */
    stopSpeaking() {
        this.ws.stopSpeaking(this.config.outpostUuid);
    }
    /** True if Podium WS is connected. */
    wsConnected() {
        return this.ws.isConnected();
    }
    /** Health checks for watchdog: WS connected, conference alive, audio rx/tx. */
    getHealthChecks() {
        return {
            wsConnected: () => this.ws.isConnected(),
            conferenceAlive: () => (this.jitsi && typeof this.jitsi.isAlive === "function" ? this.jitsi.isAlive() : true),
            audioRxTx: () => (this.jitsi && typeof this.jitsi.getRxTx === "function" ? this.jitsi.getRxTx() : null),
        };
    }
    /** Leave outpost and close connections. */
    async leave() {
        this.isLeaving = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws.setOnDisconnected(null);
        if (this.jitsi)
            await this.jitsi.leave();
        if (this.outpost) {
            this.ws.leave(this.config.outpostUuid);
            await this.api.leave(this.config.outpostUuid);
        }
        this.ws.close();
    }
}
exports.RoomClient = RoomClient;
//# sourceMappingURL=client.js.map