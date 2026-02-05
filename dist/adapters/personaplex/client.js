"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaPlexClient = void 0;
const ws_1 = __importDefault(require("ws"));
const opus_1 = require("@discordjs/opus");
const pcm_utils_1 = require("../../audio/pcm-utils");
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
// Server can take 10–20s on first connection (voice/model loading). Use a generous timeout so
// the server has time to send 0x00 before we give up. Failure is reported via stream/promise, not throw.
const PERSONAPLEX_HANDSHAKE_TIMEOUT_MS = 20_000;
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
        const voicePrompt = args.voicePrompt ?? this.config.voicePrompt;
        const seed = args.seed ?? this.config.seed;
        const serverUrl = this.config.serverUrl;
        const turnTimeoutMs = this.config.turnTimeoutMs;
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
        });
        const encoder = new opus_1.OpusEncoder(PERSONAPLEX_SAMPLE_RATE_HZ, 1);
        const audioQueue = new AsyncBufferQueue();
        const tokens = [];
        let handshakeDone = false;
        let sawAnyAudio = false;
        let lastAudioAt = Date.now();
        let sendDoneAt = null;
        let idleTimer = null;
        const textPromise = new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                try {
                    ws.close();
                }
                catch { }
                reject(new Error(`PersonaPlex turn timed out after ${turnTimeoutMs}ms`));
            }, turnTimeoutMs);
            const finish = (err) => {
                clearTimeout(timeoutTimer);
                if (idleTimer) {
                    clearInterval(idleTimer);
                    idleTimer = null;
                }
                if (err)
                    reject(err);
                else
                    resolve(tokens.join(""));
            };
            ws.on("close", () => {
                audioQueue.end();
                finish();
            });
            ws.on("error", (err) => {
                const e = err instanceof Error ? err : new Error(String(err));
                audioQueue.end(e);
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
                        const err = e instanceof Error ? e : new Error(String(e));
                        audioQueue.end(err);
                        try {
                            ws.close();
                        }
                        catch { }
                        finish(err);
                        return;
                    }
                    sawAnyAudio = true;
                    lastAudioAt = Date.now();
                    const pcm48 = (0, pcm_utils_1.resampleS16leMonoLinear)(pcm24, PERSONAPLEX_SAMPLE_RATE_HZ, ROOM_SAMPLE_RATE_HZ);
                    if (pcm48.length > 0)
                        audioQueue.push(pcm48);
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
                try {
                    // Wait for handshake bytes (0x00). Use a long timeout so server can finish loading (voice/model).
                    const start = Date.now();
                    while (!handshakeDone) {
                        if (Date.now() - start > PERSONAPLEX_HANDSHAKE_TIMEOUT_MS) {
                            const err = new Error("PersonaPlex handshake timeout (no 0x00 received).");
                            try {
                                ws.close();
                            }
                            catch { }
                            audioQueue.end(err);
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
                        ws.send(Buffer.concat([Buffer.from([0x01]), opus]));
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
                    const err = e instanceof Error ? e : new Error(String(e));
                    try {
                        ws.close();
                    }
                    catch { }
                    audioQueue.end(err);
                    finish(err);
                }
            });
        });
        return {
            audio48k: audioQueue.iterate(),
            text: textPromise,
            abort: () => {
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