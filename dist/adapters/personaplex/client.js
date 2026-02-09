"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaPlexClient = void 0;
const ws_1 = __importDefault(require("ws"));
const opus_1 = require("@discordjs/opus");
const pcm_utils_1 = require("../../audio/pcm-utils");
const logging_1 = require("../../logging");
const PERSONAPLEX_SAMPLE_RATE_HZ = 24000;
const ROOM_SAMPLE_RATE_HZ = 48000;
const INPUT_SAMPLE_RATE_HZ = 16000;
// Opus frame sizes must be one of the standard durations.
// We use 20ms for stability and predictable buffering.
const OPUS_FRAME_MS = 20;
const OPUS_SAMPLES_PER_FRAME = Math.round((PERSONAPLEX_SAMPLE_RATE_HZ * OPUS_FRAME_MS) / 1000); // 480 @ 24kHz
const OPUS_FRAME_BYTES = OPUS_SAMPLES_PER_FRAME * 2; // mono s16le
// We append a small amount of trailing silence so the model can finish speaking
// after the user stops (full-duplex models often need a tail).
const TRAILING_SILENCE_MS = 400;
const TRAILING_SILENCE_FRAMES = Math.ceil(TRAILING_SILENCE_MS / OPUS_FRAME_MS);
// After we finish sending, close when the server goes idle.
const IDLE_CLOSE_AFTER_SEND_MS = 900;
const IDLE_POLL_MS = 25;
// Server can take a long time on first connection (voice/model loading).
// The server sends a 0x00 handshake byte only after it finishes initializing the system prompt.
// Keep the timeout generous but bounded by the per-turn timeout.
const PERSONAPLEX_HANDSHAKE_TIMEOUT_FLOOR_MS = 45_000;
const PERSONAPLEX_HANDSHAKE_TIMEOUT_CEIL_MS = 180_000;
// Capacity contract: PersonaPlex behaves like a single-capacity “brain” per server URL.
// We keep a caller-side guard so we fail fast on accidental contention (misconfig, pooling, etc.)
// instead of letting it surface as a misleading long timeout.
const inflightByServerUrl = new Map();
class PersonaPlexTurnError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "PersonaPlexTurnError";
        this.code = code;
    }
}
class AsyncBufferQueue {
    queue = [];
    waiters = [];
    ended = false;
    endError = null;
    push(buf) {
        if (this.ended)
            return;
        if (this.waiters.length > 0) {
            const w = this.waiters.shift();
            w({ value: buf, done: false });
            return;
        }
        this.queue.push(buf);
    }
    end(err) {
        if (this.ended)
            return;
        this.ended = true;
        this.endError = err ?? null;
        while (this.waiters.length > 0) {
            const w = this.waiters.shift();
            if (this.endError) {
                // Throwing inside async iterator is done by rejecting next().
                // We emulate by returning done=true and then throwing on subsequent next().
                w({ value: Buffer.alloc(0), done: true });
            }
            else {
                w({ value: Buffer.alloc(0), done: true });
            }
        }
    }
    async *iterate() {
        while (true) {
            if (this.queue.length > 0) {
                yield this.queue.shift();
                continue;
            }
            if (this.ended) {
                if (this.endError)
                    throw this.endError;
                return;
            }
            const item = await new Promise((resolve) => this.waiters.push(resolve));
            if (item.done) {
                if (this.endError)
                    throw this.endError;
                return;
            }
            yield item.value;
        }
    }
}
function toWebSocketUrl(baseUrl, path) {
    const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (trimmed.startsWith("https://"))
        return `wss://${trimmed.slice("https://".length)}${path}`;
    if (trimmed.startsWith("http://"))
        return `ws://${trimmed.slice("http://".length)}${path}`;
    // Allow passing ws(s):// directly.
    if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://"))
        return `${trimmed}${path}`;
    // Fallback: assume https.
    return `wss://${trimmed}${path}`;
}
function wrapSystemTags(text) {
    // PersonaPlex expects leading and trailing spaces as tags.
    const cleaned = (text ?? "").trim();
    if (cleaned.length === 0)
        return "";
    if (cleaned.startsWith(" ") && cleaned.endsWith(" "))
        return cleaned;
    return ` ${cleaned} `;
}
class PersonaPlexClient {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Run a single PersonaPlex turn.
     *
     * Contract:
     * - Input is a user utterance segment (16kHz mono s16le PCM).
     * - Output is an async iterable yielding 48kHz mono s16le PCM chunks suitable for room injection.
     * - The returned `text` is best-effort: PersonaPlex emits token pieces during generation.
     */
    async runTurn(args) {
        // NOTE: Some TS tooling has intermittently reported `turnId` missing from PersonaPlexRunTurnArgs.
        // The runtime contract supports it (and orchestrator passes it). We access defensively.
        const maybeTurnId = args.turnId;
        const turnId = (typeof maybeTurnId === "string" && maybeTurnId.trim() ? maybeTurnId.trim() : undefined) ??
            `personaplex-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const voicePrompt = args.voicePrompt ?? this.config.voicePrompt;
        const seed = args.seed ?? this.config.seed;
        const serverUrl = (this.config.serverUrl || "").trim();
        const turnTimeoutMs = this.config.turnTimeoutMs;
        // Routing / observability identity (used by router topology, and helpful even without a router).
        const sessionKey = (() => {
            const roomId = (process.env.PODIUM_OUTPOST_UUID || "").trim();
            const agentId = (process.env.AGENT_ID || "").trim();
            if (!roomId || !agentId)
                return undefined;
            return `${roomId}:${agentId}`;
        })();
        // Acquire single-flight “capacity” per serverUrl.
        const current = inflightByServerUrl.get(serverUrl) || 0;
        if (current >= 1) {
            throw new PersonaPlexTurnError("busy", `PersonaPlex busy (another turn in-flight for ${serverUrl}).`);
        }
        inflightByServerUrl.set(serverUrl, current + 1);
        let capacityReleased = false;
        const releaseCapacity = () => {
            if (capacityReleased)
                return;
            capacityReleased = true;
            const n = inflightByServerUrl.get(serverUrl) || 0;
            if (n <= 1)
                inflightByServerUrl.delete(serverUrl);
            else
                inflightByServerUrl.set(serverUrl, n - 1);
        };
        const startedAt = Date.now();
        logging_1.logger.info({
            event: "PERSONAPLEX_TURN_START",
            turnId,
            serverUrl,
            sessionKey,
            voicePrompt,
            seed,
            timeoutMs: turnTimeoutMs,
            userPcm16kBytes: args.userPcm16k.length,
            textPromptLength: (args.textPrompt || "").length,
        }, "PersonaPlex turn started");
        const q = new URLSearchParams();
        q.set("voice_prompt", voicePrompt);
        q.set("text_prompt", wrapSystemTags(args.textPrompt));
        if (seed !== undefined)
            q.set("seed", String(seed));
        const wsUrl = `${toWebSocketUrl(serverUrl, "/api/chat")}?${q.toString()}`;
        const ws = new ws_1.default(wsUrl, {
            perMessageDeflate: false,
            handshakeTimeout: Math.min(10_000, Math.max(2_000, Math.floor(turnTimeoutMs / 3))),
            rejectUnauthorized: this.config.sslInsecure ? false : undefined,
            headers: sessionKey ? { "X-Session-Key": sessionKey } : undefined,
        });
        const encoder = new opus_1.OpusEncoder(PERSONAPLEX_SAMPLE_RATE_HZ, 1);
        const audioQueue = new AsyncBufferQueue();
        const tokens = [];
        // PersonaPlex protocol: server sends 0x00 handshake when ready; client starts streaming audio after that.
        let handshakeDone = false;
        let sawAnyAudio = false;
        let lastAudioAt = Date.now();
        let sendDoneAt = null;
        let idleTimer = null;
        let abortRequested = false;
        let wsOpenedAt = 0;
        let handshakeAt = 0;
        let firstAudioAt = 0;
        let audioFrames = 0;
        let audioBytes48k = 0;
        let ended = false;
        const endOnce = (payload) => {
            if (ended)
                return;
            ended = true;
            releaseCapacity();
            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;
            const handshakeMs = handshakeAt > 0 ? handshakeAt - (wsOpenedAt || startedAt) : undefined;
            const firstAudioMs = firstAudioAt > 0 ? firstAudioAt - startedAt : undefined;
            logging_1.logger.info({
                event: payload.ok ? "PERSONAPLEX_TURN_OK" : "PERSONAPLEX_TURN_ERROR",
                turnId,
                ok: payload.ok,
                failureType: payload.failureType,
                err: payload.err ? payload.err.message : undefined,
                wsCloseCode: payload.wsCloseCode,
                wsCloseReason: payload.wsCloseReason,
                durationMs,
                handshakeMs,
                firstAudioMs,
                sawAnyAudio,
                audioFrames,
                audioBytes48k,
                tokenChars: tokens.join("").length,
                aborted: abortRequested,
            }, payload.ok ? "PersonaPlex turn completed" : "PersonaPlex turn failed");
        };
        const textPromise = new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                const err = new PersonaPlexTurnError("turn_timeout", `PersonaPlex turn timed out after ${turnTimeoutMs}ms`);
                // End the audio stream so the orchestrator's for-await exits and can run fallback.
                audioQueue.end(err);
                endOnce({ ok: false, failureType: "turn_timeout", err });
                finish(err);
                try {
                    ws.close();
                }
                catch { }
            }, turnTimeoutMs);
            const finish = (err) => {
                clearTimeout(timeoutTimer);
                if (idleTimer) {
                    clearInterval(idleTimer);
                    idleTimer = null;
                }
                // Capacity is typically released via endOnce; this is a safety net.
                releaseCapacity();
                if (err)
                    reject(err);
                else
                    resolve(tokens.join(""));
            };
            ws.on("close", (code, reasonBuf) => {
                const wsCloseCode = typeof code === "number" ? code : undefined;
                const wsCloseReason = reasonBuf ? Buffer.from(reasonBuf).toString("utf8") : undefined;
                if (abortRequested) {
                    audioQueue.end();
                    endOnce({ ok: true, wsCloseCode, wsCloseReason });
                    finish();
                    return;
                }
                // Deterministic failure: server closed before indicating readiness.
                if (!handshakeDone) {
                    const err = new PersonaPlexTurnError("handshake_failed", "PersonaPlex closed before handshake completed.");
                    audioQueue.end(err);
                    endOnce({ ok: false, failureType: "handshake_failed", err, wsCloseCode, wsCloseReason });
                    finish(err);
                    return;
                }
                if (!sawAnyAudio) {
                    const err = new PersonaPlexTurnError("no_audio", "PersonaPlex closed without producing any audio frames.");
                    audioQueue.end(err);
                    endOnce({ ok: false, failureType: "no_audio", err, wsCloseCode, wsCloseReason });
                    finish(err);
                    return;
                }
                audioQueue.end();
                endOnce({ ok: true, wsCloseCode, wsCloseReason });
                finish();
            });
            ws.on("error", (err) => {
                const e0 = err instanceof Error ? err : new Error(String(err));
                const e = new PersonaPlexTurnError("ws_error", e0.message);
                audioQueue.end(e);
                endOnce({ ok: false, failureType: "ws_error", err: e });
                finish(e);
            });
            ws.on("message", (data, isBinary) => {
                if (!isBinary)
                    return;
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (buf.length === 0)
                    return;
                const kind = buf[0];
                if (kind === 0x00) {
                    handshakeDone = true;
                    if (handshakeAt === 0) {
                        handshakeAt = Date.now();
                        logging_1.logger.info({ event: "PERSONAPLEX_HANDSHAKE_OK", turnId, handshakeMs: handshakeAt - (wsOpenedAt || startedAt) }, "PersonaPlex handshake completed");
                    }
                    return;
                }
                if (!handshakeDone) {
                    // Ignore anything until handshake.
                    return;
                }
                if (kind === 0x01) {
                    // Audio (Opus @ 24kHz)
                    const opus = buf.subarray(1);
                    if (opus.length === 0)
                        return;
                    let pcm24;
                    try {
                        pcm24 = encoder.decode(opus);
                    }
                    catch (e) {
                        // If decode fails, end the stream. This is safer than injecting garbage audio.
                        const err0 = e instanceof Error ? e : new Error(String(e));
                        const err = new PersonaPlexTurnError("decode_error", err0.message);
                        audioQueue.end(err);
                        try {
                            ws.close();
                        }
                        catch { }
                        endOnce({ ok: false, failureType: "decode_error", err });
                        finish(err);
                        return;
                    }
                    sawAnyAudio = true;
                    lastAudioAt = Date.now();
                    if (firstAudioAt === 0) {
                        firstAudioAt = lastAudioAt;
                        logging_1.logger.info({ event: "PERSONAPLEX_FIRST_AUDIO", turnId, firstAudioMs: firstAudioAt - startedAt }, "PersonaPlex first audio received");
                    }
                    const pcm48 = (0, pcm_utils_1.resampleS16leMonoLinear)(pcm24, PERSONAPLEX_SAMPLE_RATE_HZ, ROOM_SAMPLE_RATE_HZ);
                    if (pcm48.length > 0) {
                        audioFrames += 1;
                        audioBytes48k += pcm48.length;
                        audioQueue.push(pcm48);
                    }
                    return;
                }
                if (kind === 0x02) {
                    const tokenPiece = buf.subarray(1).toString("utf8");
                    if (tokenPiece.length > 0)
                        tokens.push(tokenPiece);
                    return;
                }
            });
            ws.on("open", async () => {
                wsOpenedAt = Date.now();
                try {
                    // Wait for handshake bytes (0x00). Server may still be initializing voice/system prompts.
                    const handshakeTimeoutMs = Math.min(PERSONAPLEX_HANDSHAKE_TIMEOUT_CEIL_MS, Math.max(PERSONAPLEX_HANDSHAKE_TIMEOUT_FLOOR_MS, Math.floor(turnTimeoutMs * 0.8)));
                    const start = Date.now();
                    while (!handshakeDone) {
                        if (Date.now() - start > handshakeTimeoutMs) {
                            const err = new PersonaPlexTurnError("handshake_timeout", "PersonaPlex handshake timeout (no 0x00 received).");
                            try {
                                ws.close();
                            }
                            catch { }
                            audioQueue.end(err);
                            endOnce({ ok: false, failureType: "handshake_timeout", err });
                            finish(err);
                            return;
                        }
                        await new Promise((r) => setTimeout(r, 10));
                    }
                    // Convert 16k PCM to 24k PCM, then chunk into 20ms frames.
                    const pcm24 = (0, pcm_utils_1.resampleS16leMonoLinear)(args.userPcm16k, INPUT_SAMPLE_RATE_HZ, PERSONAPLEX_SAMPLE_RATE_HZ);
                    const { frames, tail } = (0, pcm_utils_1.chunkPcmByBytes)(pcm24, OPUS_FRAME_BYTES);
                    const allFrames = [...frames];
                    if (tail.length > 0)
                        allFrames.push((0, pcm_utils_1.padWithSilence)(tail, OPUS_FRAME_BYTES));
                    // Append a short silence tail so the model can finish.
                    for (let i = 0; i < TRAILING_SILENCE_FRAMES; i++) {
                        allFrames.push(Buffer.alloc(OPUS_FRAME_BYTES));
                    }
                    for (const frame of allFrames) {
                        // Server expects: 0x01 + opus bytes
                        const opus = encoder.encode(frame);
                        try {
                            ws.send(Buffer.concat([Buffer.from([0x01]), opus]));
                        }
                        catch (e) {
                            const err0 = e instanceof Error ? e : new Error(String(e));
                            const err = new PersonaPlexTurnError("send_error", err0.message);
                            try {
                                ws.close();
                            }
                            catch { }
                            audioQueue.end(err);
                            endOnce({ ok: false, failureType: "send_error", err });
                            finish(err);
                            return;
                        }
                    }
                    sendDoneAt = Date.now();
                    // Close after server goes idle post-send, or after timeout.
                    idleTimer = setInterval(() => {
                        if (sendDoneAt == null)
                            return;
                        const now = Date.now();
                        const idleMs = now - lastAudioAt;
                        const sinceSendDoneMs = now - sendDoneAt;
                        // Don't close too early: wait a minimum time after send completes.
                        if (sinceSendDoneMs < Math.min(300, IDLE_CLOSE_AFTER_SEND_MS / 3))
                            return;
                        if ((!sawAnyAudio && sinceSendDoneMs > IDLE_CLOSE_AFTER_SEND_MS) || (sawAnyAudio && idleMs > IDLE_CLOSE_AFTER_SEND_MS)) {
                            if (idleTimer) {
                                clearInterval(idleTimer);
                                idleTimer = null;
                            }
                            try {
                                ws.close();
                            }
                            catch { }
                        }
                    }, IDLE_POLL_MS);
                }
                catch (e) {
                    const err0 = e instanceof Error ? e : new Error(String(e));
                    const err = new PersonaPlexTurnError("unexpected_error", err0.message);
                    try {
                        ws.close();
                    }
                    catch { }
                    audioQueue.end(err);
                    endOnce({ ok: false, failureType: "unexpected_error", err });
                    finish(err);
                }
            });
        });
        return {
            audio48k: audioQueue.iterate(),
            text: textPromise,
            abort: () => {
                abortRequested = true;
                try {
                    ws.close();
                }
                catch { }
            },
        };
    }
}
exports.PersonaPlexClient = PersonaPlexClient;
//# sourceMappingURL=client.js.map