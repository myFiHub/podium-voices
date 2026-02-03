"use strict";
/**
 * Podium WebSocket client.
 * Connect with ?token=<token>&timezone=<IANA>.
 * Outgoing messages must use exact keys: message_type (lowercase, e.g. "join"), outpost_uuid (snake_case).
 *
 * Muting/speaking: start_speaking when bot unmutes, stop_speaking when bot mutes (see docs/AGENT_MUTING_AND_SPEAKING_TIME.md).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PodiumWS = void 0;
const ws_1 = __importDefault(require("ws"));
const types_1 = require("./types");
const logging_1 = require("../logging");
/** Podium backend expects lowercase message_type values (e.g. "join", not "JOIN"). */
const WS_SEND_TYPES = {
    JOIN: "join",
    LEAVE: "leave",
    START_SPEAKING: "start_speaking",
    STOP_SPEAKING: "stop_speaking",
};
class PodiumWS {
    ws = null;
    config;
    handlers = [];
    constructor(config) {
        this.config = config;
    }
    onMessage(handler) {
        this.handlers.push(handler);
    }
    connect() {
        const token = this.config.token?.trim() ?? "";
        if (!token) {
            return Promise.reject(new Error("WebSocket auth: token is missing. Set PODIUM_TOKEN in .env.local."));
        }
        const tz = this.config.timezone ?? (typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone) ?? "America/New_York";
        const url = `${this.config.wsAddress}?token=${encodeURIComponent(token)}&timezone=${encodeURIComponent(tz)}`;
        const urlForLog = `${this.config.wsAddress}?token=${token ? "[REDACTED]" : "[MISSING]"}&timezone=${encodeURIComponent(tz)}`;
        logging_1.logger.debug({ event: "WS_CONNECT", url: urlForLog, hasToken: !!token, timezone: tz }, "WebSocket connecting (auth in URL)");
        return new Promise((resolve, reject) => {
            this.ws = new ws_1.default(url);
            this.ws.on("open", () => resolve());
            this.ws.on("error", reject);
            this.ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.name === "error") {
                        const errMsg = msg.data?.message;
                        logging_1.logger.warn({ event: "WS_ERROR", message: errMsg, data: msg.data }, "WebSocket server error");
                    }
                    logging_1.logger.debug({ event: "WS_MESSAGE", name: msg.name, data: msg.data }, "WebSocket message");
                    this.handlers.forEach((h) => h(msg));
                }
                catch {
                    // ignore parse errors
                }
            });
        });
    }
    send(msg) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            logging_1.logger.debug({ event: "WS_SEND_SKIP", reason: "not connected" }, "WebSocket send skipped (not connected)");
            return;
        }
        const str = JSON.stringify(msg);
        logging_1.logger.debug({ event: "WS_SEND", payload: str }, "WebSocket send");
        this.ws.send(str);
    }
    /** Send JOIN and wait for user.joined for this user (match by address or uuid). */
    async joinOutpost(outpostUuid, myAddress, options) {
        const myUuid = options?.myUuid;
        const timeoutMs = options?.timeoutMs ?? 15000;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                logging_1.logger.warn({ event: "WS_JOIN_TIMEOUT", outpostUuid, myAddress }, "Join timeout – no user.joined received");
                reject(new Error("Join timeout"));
            }, timeoutMs);
            const handler = (msg) => {
                const isJoinEvent = msg.name === types_1.WS_INCOMING_NAMES.USER_JOINED || msg.name === "user_joined";
                if (!isJoinEvent)
                    return;
                const data = msg.data;
                const matchAddress = data && typeof data.address === "string" && data.address === myAddress;
                const matchUuid = myUuid && data && typeof data.uuid === "string" && data.uuid === myUuid;
                if (matchAddress || matchUuid) {
                    clearTimeout(timer);
                    this.handlers = this.handlers.filter((h) => h !== handler);
                    resolve();
                }
            };
            this.onMessage(handler);
            const payload = { message_type: WS_SEND_TYPES.JOIN, outpost_uuid: outpostUuid, data: {} };
            logging_1.logger.debug({ event: "WS_JOIN_SEND", outpostUuid, payload }, "Sending JOIN");
            this.send(payload);
        });
    }
    leave(outpostUuid) {
        this.send({ message_type: WS_SEND_TYPES.LEAVE, outpost_uuid: outpostUuid, data: {} });
    }
    startSpeaking(outpostUuid) {
        this.send({ message_type: WS_SEND_TYPES.START_SPEAKING, outpost_uuid: outpostUuid, data: {} });
    }
    stopSpeaking(outpostUuid) {
        this.send({ message_type: WS_SEND_TYPES.STOP_SPEAKING, outpost_uuid: outpostUuid, data: {} });
    }
    /** Reactions: data must include react_to_user_address (wallet address of target user). */
    sendReaction(outpostUuid, reactionType, reactToUserAddress) {
        this.send({
            message_type: reactionType,
            outpost_uuid: outpostUuid,
            data: { react_to_user_address: reactToUserAddress },
        });
    }
    /** True if WebSocket is open (for watchdog). */
    isConnected() {
        return this.ws != null && this.ws.readyState === ws_1.default.OPEN;
    }
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
exports.PodiumWS = PodiumWS;
//# sourceMappingURL=ws.js.map