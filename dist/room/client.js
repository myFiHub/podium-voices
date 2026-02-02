"use strict";
/**
 * High-level Podium room client: runs host join flow and exposes audio in/out.
 * Uses REST (api), WebSocket (ws), and Jitsi (jitsi) to join as host; then provides
 * incoming audio stream for the pipeline and a method to push TTS output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = void 0;
const api_1 = require("./api");
const ws_1 = require("./ws");
const jitsi_1 = require("./jitsi");
const vad_1 = require("../pipeline/vad");
class RoomClient {
    api;
    ws;
    jitsi = null;
    user = null;
    outpost = null;
    config;
    callbacks = {};
    constructor(config) {
        this.config = config;
        this.api = new api_1.PodiumApi({ baseUrl: config.apiUrl, token: config.token });
        this.ws = new ws_1.PodiumWS({
            wsAddress: config.wsAddress,
            token: config.token,
        });
    }
    onAudioChunk(cb) {
        this.callbacks.onAudioChunk = cb;
    }
    /** Run full host join flow. Returns when joined (WS + optional Jitsi). */
    async join() {
        this.user = await this.api.getProfile();
        this.outpost = await this.api.getOutpost(this.config.outpostUuid);
        const canEnter = this.user.uuid === this.outpost.creator_user_uuid ||
            (this.outpost.cohost_user_uuids ?? []).includes(this.user.uuid);
        if (!canEnter) {
            throw new Error("User is not creator or cohost; cannot enter.");
        }
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
            await this.jitsi.start();
        }
        return { user: this.user, outpost: this.outpost };
    }
    /** Push TTS audio to the room (PCM 16-bit mono). */
    pushTtsAudio(buffer) {
        this.jitsi?.pushAudio(buffer);
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