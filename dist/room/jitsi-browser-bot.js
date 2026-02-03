"use strict";
/**
 * Jitsi room implementation backed by a Playwright-controlled browser loading
 * a minimal bot join page. Node↔browser audio over WebSocket (48kHz 20ms frames);
 * Node resamples 48k→16k for onIncomingAudio.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JitsiBrowserBot = void 0;
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const audio_utils_1 = require("../pipeline/audio-utils");
const audio_bridge_protocol_1 = require("./audio-bridge-protocol");
const logging_1 = require("../logging");
const DEFAULT_BRIDGE_PORT = 8766;
const BRIDGE_PORT_RETRY_COUNT = 25;
const MAX_TX_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB of 48kHz s16le (~21s) safety cap.
/** Strip protocol and path so libUrl and bot config always use a valid hostname. */
function domainHostOnly(domain) {
    if (!domain || typeof domain !== "string")
        return domain;
    return domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || domain;
}
class JitsiBrowserBot {
    config;
    onIncomingAudioCb = null;
    server = null;
    wss = null;
    ws = null;
    browser = null;
    page = null;
    bridgePort = DEFAULT_BRIDGE_PORT;
    txBuffer = Buffer.alloc(0);
    txQueue = [];
    txInterval = null;
    closed = false;
    rxBytesTotal = 0;
    txBytesTotal = 0;
    lastRxTxAt = 0;
    statsInterval = null;
    lastBotStatsWarnAt = 0;
    lastStats = null;
    loggedTxFrameSample = false;
    txSeq = 0;
    debugFrames = process.env.DEBUG_AUDIO_FRAMES === "1";
    saveWav = process.env.SAVE_TTS_WAV === "1";
    wavBuffers = [];
    wavBytes = 0;
    wroteWav = false;
    constructor(config) {
        this.config = config;
    }
    onIncomingAudio(callback) {
        this.onIncomingAudioCb = callback;
    }
    flushTxFrames() {
        if (this.closed)
            return;
        if (this.txBuffer.length < audio_bridge_protocol_1.BRIDGE_FRAME_BYTES)
            return;
        const frames = (0, audio_bridge_protocol_1.chunk48k20ms)(this.txBuffer);
        const consumed = frames.length * audio_bridge_protocol_1.BRIDGE_FRAME_BYTES;
        this.txBuffer = consumed >= this.txBuffer.length ? Buffer.alloc(0) : this.txBuffer.subarray(consumed);
        for (const frame of frames) {
            // Copy: `frame` is a Buffer slice.
            this.txQueue.push(Buffer.from(frame));
        }
    }
    pushAudio(buffer) {
        if (this.closed)
            return;
        if (buffer.length === 0)
            return;
        // Debug-only: capture raw PCM sent toward the bot page so we can save a WAV and inspect it.
        if (this.saveWav && !this.wroteWav) {
            this.wavBuffers.push(buffer);
            this.wavBytes += buffer.length;
            // Cap capture to ~3 seconds at 48k mono s16le: 48000*2*3 = 288000 bytes.
            if (this.wavBytes >= 288000) {
                try {
                    const pcm = Buffer.concat(this.wavBuffers, this.wavBytes);
                    const wav = (0, audio_utils_1.pcmToWav)(pcm, 48000);
                    const outDir = path.resolve(process.cwd(), "debug-audio");
                    if (!fs.existsSync(outDir))
                        fs.mkdirSync(outDir, { recursive: true });
                    const outPath = path.join(outDir, `tts_node_tx_${Date.now()}.wav`);
                    fs.writeFileSync(outPath, wav);
                    logging_1.logger.warn({ event: "AUDIO_WAV_SAVED", where: "node_tx", path: outPath, bytes: wav.length }, "Saved node TX WAV capture");
                    this.wroteWav = true;
                }
                catch (e) {
                    logging_1.logger.warn({ event: "AUDIO_WAV_SAVE_FAILED", where: "node_tx", err: e.message }, "Failed saving node TX WAV");
                }
            }
        }
        this.txBuffer = Buffer.concat([this.txBuffer, buffer]);
        // Prevent unbounded buffering if the bridge isn't connected yet (or if TTS outruns WS).
        if (this.txBuffer.length > MAX_TX_BUFFER_BYTES) {
            const dropped = this.txBuffer.length - MAX_TX_BUFFER_BYTES;
            this.txBuffer = this.txBuffer.subarray(dropped);
            logging_1.logger.warn({ event: "BOT_TX_BUFFER_DROPPED", droppedBytes: dropped }, "Dropping oldest buffered TTS audio (tx buffer cap)");
        }
        this.flushTxFrames();
    }
    /** True if browser and bridge are alive (for watchdog). */
    isAlive() {
        return !this.closed && this.browser != null && this.page != null && this.ws != null && this.ws.readyState === 1;
    }
    /** Rx/tx byte totals (for watchdog). */
    getRxTx() {
        return { rx: this.rxBytesTotal, tx: this.txBytesTotal };
    }
    async leave() {
        this.closed = true;
        if (this.statsInterval)
            clearInterval(this.statsInterval);
        this.statsInterval = null;
        if (this.txInterval)
            clearInterval(this.txInterval);
        this.txInterval = null;
        this.txQueue = [];
        if (this.page)
            try {
                await this.page.close();
            }
            catch (e) {
                logging_1.logger.warn({ err: e }, "Bot page close");
            }
        this.page = null;
        if (this.browser)
            try {
                await this.browser.close();
            }
            catch (e) {
                logging_1.logger.warn({ err: e }, "Bot browser close");
            }
        this.browser = null;
        if (this.ws)
            try {
                this.ws.close();
            }
            catch (_) { }
        this.ws = null;
        if (this.wss)
            try {
                this.wss.close();
            }
            catch (_) { }
        this.wss = null;
        if (this.server)
            await new Promise((resolve) => { this.server.close(() => resolve()); });
        this.server = null;
    }
    /** Start bridge server (HTTP + WebSocket), launch browser, load bot page; on WS connect send join. */
    async start() {
        if (this.server)
            return;
        // Resolve bot-page relative to this file (dist/room/ -> project root -> bot-page) so it works regardless of cwd.
        const botPageDir = path.join(__dirname, "..", "..", "bot-page");
        const indexHtml = path.join(botPageDir, "bot.html");
        const indexJs = path.join(botPageDir, "bot.js");
        this.server = http.createServer((req, res) => {
            const rawUrl = req.url || "/";
            const pathname = rawUrl.split("?")[0];
            if (pathname.startsWith("/bridge")) {
                logging_1.logger.info({ event: "HTTP_REQUEST_TO_BRIDGE_PATH", method: req.method, url: rawUrl }, "HTTP request to /bridge (expected WebSocket upgrade)");
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Use WebSocket to /bridge");
                return;
            }
            if (pathname === "/favicon.ico") {
                res.writeHead(204);
                res.end();
                return;
            }
            if (pathname === "/" || pathname === "/bot.html") {
                fs.readFile(indexHtml, (err, data) => {
                    if (err) {
                        logging_1.logger.warn({ event: "BOT_PAGE_SERVE_ERROR", path: indexHtml, err: err.message }, "Failed to serve bot.html");
                        res.writeHead(404);
                        res.end("Not found");
                        return;
                    }
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(data);
                });
                return;
            }
            if (pathname === "/bot.js") {
                fs.readFile(indexJs, (err, data) => {
                    if (err) {
                        logging_1.logger.warn({ event: "BOT_PAGE_SERVE_ERROR", path: indexJs, err: err.message }, "Failed to serve bot.js");
                        res.writeHead(404);
                        res.end("Not found");
                        return;
                    }
                    res.writeHead(200, { "Content-Type": "application/javascript" });
                    res.end(data);
                });
                return;
            }
            res.writeHead(404);
            res.end("Not found");
        });
        const { WebSocketServer } = await Promise.resolve().then(() => __importStar(require("ws")));
        this.wss = new WebSocketServer({ noServer: true });
        this.server.on("upgrade", (request, socket, head) => {
            logging_1.logger.info({ event: "HTTP_UPGRADE", url: request.url, origin: request.headers.origin, host: request.headers.host }, "HTTP upgrade request received");
            const url = new URL(request.url || "", `http://${request.headers.host}`);
            if (url.pathname === "/bridge") {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit("connection", ws, request);
                });
            }
            else {
                socket.destroy();
            }
        });
        const startPort = this.config.bridgePort ?? DEFAULT_BRIDGE_PORT;
        const maxPort = startPort + BRIDGE_PORT_RETRY_COUNT - 1;
        let bound = false;
        for (let port = startPort; port <= maxPort; port++) {
            try {
                await new Promise((resolve, reject) => {
                    const onError = (err) => {
                        this.server.removeListener("error", onError);
                        reject(err);
                    };
                    this.server.once("error", onError);
                    // Bind to 0.0.0.0 so headless browser can connect in WSL2 (loopback can be flaky).
                    this.server.listen(port, "0.0.0.0", () => {
                        this.server.removeListener("error", onError);
                        this.bridgePort = port;
                        bound = true;
                        resolve();
                    });
                });
                if (port !== startPort) {
                    logging_1.logger.info({ event: "BRIDGE_PORT_BOUND", port, previousPortInUse: startPort }, "Bridge bound to port (default was in use)");
                }
                break;
            }
            catch (err) {
                const e = err;
                if (e.code === "EADDRINUSE" && port < maxPort) {
                    logging_1.logger.warn({ event: "BRIDGE_PORT_IN_USE", port }, "Port in use, trying next");
                    continue;
                }
                throw err;
            }
        }
        if (!bound) {
            // As a last resort, bind to an ephemeral port chosen by the OS.
            await new Promise((resolve, reject) => {
                const onError = (err) => {
                    this.server.removeListener("error", onError);
                    reject(err);
                };
                this.server.once("error", onError);
                this.server.listen(0, "0.0.0.0", () => {
                    this.server.removeListener("error", onError);
                    const addr = this.server.address();
                    if (addr && typeof addr === "object")
                        this.bridgePort = addr.port;
                    bound = true;
                    resolve();
                });
            });
            logging_1.logger.warn({ event: "BRIDGE_PORT_BOUND_RANDOM", port: this.bridgePort, attemptedStartPort: startPort, attemptedMaxPort: maxPort }, "Bridge bound to random port after conflicts");
        }
        const BRIDGE_CONNECT_TIMEOUT_MS = 15000;
        let resolveBridgeConnected;
        const bridgeConnectedPromise = new Promise((resolve) => {
            resolveBridgeConnected = resolve;
        });
        this.wss.on("connection", (ws) => {
            this.ws = ws;
            resolveBridgeConnected();
            ws.binaryType = "nodebuffer";
            ws.on("message", (data) => {
                if (this.closed)
                    return;
                if (Buffer.isBuffer(data) && data.length === audio_bridge_protocol_1.BRIDGE_FRAME_BYTES) {
                    this.rxBytesTotal += data.length;
                    this.lastRxTxAt = Date.now();
                    const pcm16 = (0, audio_bridge_protocol_1.resample48kTo16k)(data);
                    this.onIncomingAudioCb?.(pcm16, audio_bridge_protocol_1.VAD_SAMPLE_RATE);
                    return;
                }
                try {
                    const str = typeof data === "string" ? data : data.toString("utf8");
                    const msg = JSON.parse(str);
                    if (msg.type === "join_result") {
                        if (msg.success) {
                            logging_1.logger.info({ event: "BOT_JITSI_JOINED" }, "Bot joined Jitsi conference");
                        }
                        else {
                            logging_1.logger.error({ event: "BOT_JITSI_JOIN_FAILED", error: msg.error }, "Bot failed to join Jitsi: " + (msg.error ?? "unknown"));
                        }
                    }
                    else if (msg.type === "join_error") {
                        logging_1.logger.error({ event: "BOT_JOIN_ERROR", error: msg.error }, "Bot join failed (e.g. script load): " + (msg.error ?? "unknown"));
                    }
                    else if (msg.type === "page_error") {
                        logging_1.logger.error({
                            event: "BOT_PAGE_ERROR_DETAIL",
                            name: msg.name,
                            message: msg.message,
                            filename: msg.filename,
                            lineno: msg.lineno,
                            colno: msg.colno,
                            stack: msg.stack,
                        }, "Bot page window.onerror");
                    }
                    else if (msg.type === "unhandled_rejection") {
                        logging_1.logger.error({ event: "BOT_PAGE_UNHANDLED_REJECTION", name: msg.name, message: msg.message, stack: msg.stack }, "Bot page unhandled rejection");
                    }
                    else if (msg.type === "track_disposed") {
                        logging_1.logger.warn({ event: "BOT_TRACK_DISPOSED", detail: msg }, "Bot synthetic track disposed unexpectedly");
                    }
                    else if (msg.type === "frame_ack") {
                        logging_1.logger.warn({
                            event: "BOT_FRAME_ACK",
                            seq: msg.seq,
                            xorHeader: msg.xorHeader,
                            xorComputed: msg.xorComputed,
                            maxAbs: msg.maxAbs,
                            nonZero: msg.nonZero,
                        }, "Bot page received debug audio frame");
                    }
                    else if (msg.type === "stats" && msg.stats) {
                        this.lastStats = msg.stats;
                        // Only warn on suspicious states to keep logs clean at LOG_LEVEL=warn.
                        const now = Date.now();
                        const confState = typeof msg.stats.conference_state === "string" ? msg.stats.conference_state : "";
                        const audioCtx = typeof msg.stats.audio_context_state === "string" ? msg.stats.audio_context_state : "";
                        const iceState = typeof msg.stats.ice_state === "string" ? msg.stats.ice_state : "";
                        const txBytesFromPage = typeof msg.stats.tx_bytes === "number" ? msg.stats.tx_bytes : 0;
                        const txRms = typeof msg.stats.tx_rms === "number" ? msg.stats.tx_rms : undefined;
                        const txFrameRms = typeof msg.stats.tx_frame_rms === "number" ? msg.stats.tx_frame_rms : undefined;
                        const txFrameMaxAbs = typeof msg.stats.tx_frame_max_abs === "number" ? msg.stats.tx_frame_max_abs : undefined;
                        const txFrameNonZero = typeof msg.stats.tx_frame_nonzero === "number" ? msg.stats.tx_frame_nonzero : undefined;
                        const txFrameXor = typeof msg.stats.tx_frame_xor === "number" ? msg.stats.tx_frame_xor : undefined;
                        const shouldWarn = (confState && confState !== "joined") ||
                            (audioCtx && audioCtx !== "running") ||
                            (iceState && (iceState === "failed" || iceState === "disconnected")) ||
                            // If Node has pushed audio but the page hasn't received bytes, the bridge TX path is broken.
                            (this.txBytesTotal > 0 && txBytesFromPage === 0) ||
                            // If the page is receiving mic frames but the output RMS stays ~0, the synthetic mic graph is silent.
                            (txBytesFromPage > 0 && txRms !== undefined && txRms <= 0.0001) ||
                            // If incoming frames are silent, TTS audio is likely silent (or wrong format).
                            (txBytesFromPage > 0 && txFrameRms !== undefined && txFrameRms <= 0.0001) ||
                            (txBytesFromPage > 0 && txFrameMaxAbs !== undefined && txFrameMaxAbs === 0) ||
                            (txBytesFromPage > 0 && txFrameNonZero !== undefined && txFrameNonZero === 0) ||
                            (txBytesFromPage > 0 && txFrameXor !== undefined && txFrameXor === 0);
                        if (shouldWarn && now - this.lastBotStatsWarnAt > 60_000) {
                            this.lastBotStatsWarnAt = now;
                            logging_1.logger.warn({ event: "BOT_PAGE_STATS_WARN", stats: msg.stats }, "Bot page stats indicate potential audio/connectivity issue");
                        }
                    }
                    else if (msg.type === "wav_capture" && typeof msg.pcm48_b64 === "string") {
                        try {
                            const label = (msg.label ?? "page").replace(/[^a-z0-9_-]/gi, "_");
                            const pcm = Buffer.from(msg.pcm48_b64, "base64");
                            const wav = (0, audio_utils_1.pcmToWav)(pcm, 48000);
                            const outDir = path.resolve(process.cwd(), "debug-audio");
                            if (!fs.existsSync(outDir))
                                fs.mkdirSync(outDir, { recursive: true });
                            const outPath = path.join(outDir, `tts_${label}_${Date.now()}.wav`);
                            fs.writeFileSync(outPath, wav);
                            logging_1.logger.warn({ event: "AUDIO_WAV_SAVED", where: label, path: outPath, bytes: wav.length }, "Saved page WAV capture");
                        }
                        catch (e) {
                            logging_1.logger.warn({ event: "AUDIO_WAV_SAVE_FAILED", where: "page", err: e.message }, "Failed saving page WAV");
                        }
                    }
                }
                catch {
                    // ignore non-JSON or parse errors
                }
            });
            ws.on("close", () => { this.ws = null; });
            // If TTS was produced before the bridge connected, flush it now.
            this.flushTxFrames();
            // Start paced sender: send exactly one 20ms frame per tick.
            if (this.txInterval)
                clearInterval(this.txInterval);
            this.txInterval = setInterval(() => {
                try {
                    if (this.closed || !this.ws || this.ws.readyState !== 1)
                        return;
                    const frame = this.txQueue.shift();
                    if (!frame)
                        return;
                    // Contract check (debug): log a single sample of outgoing PCM to ensure it isn't all-zero at send time.
                    if (!this.loggedTxFrameSample && frame.length === audio_bridge_protocol_1.BRIDGE_FRAME_BYTES) {
                        this.loggedTxFrameSample = true;
                        let maxAbs = 0;
                        let nonZero = 0;
                        let xor = 0;
                        for (let off = 0; off + 2 <= frame.length; off += 2) {
                            const s = frame.readInt16LE(off);
                            const a = Math.abs(s);
                            if (a > maxAbs)
                                maxAbs = a;
                            if (s !== 0)
                                nonZero++;
                        }
                        for (let i = 0; i < frame.length; i++)
                            xor ^= frame[i];
                        logging_1.logger.warn({ event: "BOT_TX_FRAME_SAMPLE", frameBytes: frame.length, maxAbs, nonZero, xor }, "Outgoing bridge frame sample (s16le) for contract verification");
                    }
                    if (this.debugFrames) {
                        const seq = this.txSeq++ >>> 0;
                        let xor = 0;
                        for (let i = 0; i < frame.length; i++)
                            xor ^= frame[i];
                        const header = Buffer.allocUnsafe(5);
                        header.writeUInt32LE(seq, 0);
                        header.writeUInt8(xor & 0xff, 4);
                        this.ws.send(Buffer.concat([header, frame]));
                    }
                    else {
                        this.ws.send(frame);
                    }
                    this.txBytesTotal += frame.length;
                    this.lastRxTxAt = Date.now();
                }
                catch {
                    // ignore
                }
            }, audio_bridge_protocol_1.BRIDGE_FRAME_MS);
            // Poll for bot stats (jitter buffer, AudioContext state). Warn only when unhealthy.
            if (this.statsInterval)
                clearInterval(this.statsInterval);
            this.statsInterval = setInterval(() => {
                try {
                    if (this.closed || !this.ws || this.ws.readyState !== 1)
                        return;
                    this.ws.send(JSON.stringify({ type: "get_stats" }));
                }
                catch {
                    // ignore
                }
            }, 5000);
            const host = domainHostOnly(this.config.domain);
            const joinConfig = {
                domain: host,
                xmppDomain: this.config.xmppDomain,
                mucDomain: this.config.mucDomain,
                roomName: this.config.roomName,
                user: this.config.user,
                creatorUuid: this.config.creatorUuid,
                cohostUuids: this.config.cohostUuids,
                libUrl: `https://${host}/libs/lib-jitsi-meet.min.js`,
            };
            if (this.config.jwt)
                joinConfig.jwt = this.config.jwt;
            ws.send(JSON.stringify({ type: "join", config: joinConfig }));
            logging_1.logger.info({ event: "BOT_JOIN_SENT", domain: host, xmppDomain: this.config.xmppDomain, roomName: this.config.roomName }, "Sent join to bot page");
        });
        const playwright = await Promise.resolve().then(() => __importStar(require("playwright")));
        this.browser = await playwright.chromium.launch({
            headless: true,
            args: [
                "--autoplay-policy=no-user-gesture-required",
                "--disable-features=AudioServiceOutOfProcess",
                "--no-sandbox",
                "--disable-web-security",
                "--disable-features=BlockInsecurePrivateNetworkRequests",
            ],
        });
        const context = await this.browser.newContext({
            permissions: ["microphone"],
            ignoreHTTPSErrors: true,
        });
        this.page = await context.newPage();
        this.page.on("pageerror", (err) => {
            logging_1.logger.warn({ event: "BOT_PAGE_ERROR", name: err.name, message: err.message, stack: err.stack }, "Bot page JS error: " + err.message);
        });
        this.page.on("console", (msg) => {
            const text = msg.text();
            const type = msg.type();
            // Forward only high-signal console output at warn/error. Everything else is debug to avoid log floods.
            if (type === "error") {
                logging_1.logger.error({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
            }
            else if (type === "warning") {
                logging_1.logger.warn({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
            }
            else {
                logging_1.logger.debug({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
            }
        });
        this.page.on("websocket", (ws) => {
            logging_1.logger.info({ event: "PW_WEBSOCKET_CREATED", url: ws.url() }, "Playwright: WebSocket created");
            ws.on("framesent", (e) => logging_1.logger.debug({ event: "PW_WS_SENT", payload: e.payload }, "PW WS sent"));
            ws.on("framereceived", (e) => logging_1.logger.debug({ event: "PW_WS_RECV", payload: e.payload }, "PW WS recv"));
            ws.on("close", () => logging_1.logger.info({ event: "PW_WS_CLOSE" }, "Playwright: WebSocket closed"));
        });
        // If BOT_PAGE_URL is set, make it robust:
        // - Ensure it points at the actual bridge port when using localhost/127.0.0.1.
        // - Ensure the bot page has the ?ws= bridge param; otherwise it defaults to ws://127.0.0.1:8766/bridge and breaks if port differs.
        const defaultPageUrl = `http://127.0.0.1:${this.bridgePort}/bot.html?ws=ws://127.0.0.1:${this.bridgePort}/bridge`;
        let pageUrl = defaultPageUrl;
        if (!this.config.botPageUrl && process.env.SAVE_TTS_WAV === "1") {
            try {
                const u = new URL(pageUrl);
                if (!u.searchParams.has("saveWav"))
                    u.searchParams.set("saveWav", "1");
                pageUrl = u.toString();
            }
            catch {
                // ignore
            }
        }
        if (this.config.botPageUrl) {
            try {
                const u = new URL(this.config.botPageUrl);
                if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
                    u.hostname = "127.0.0.1";
                    u.port = String(this.bridgePort);
                }
                if (!u.searchParams.has("ws")) {
                    u.searchParams.set("ws", `ws://127.0.0.1:${this.bridgePort}/bridge`);
                }
                // Debug-only: enable WAV capture from bot page.
                if (process.env.SAVE_TTS_WAV === "1" && !u.searchParams.has("saveWav")) {
                    u.searchParams.set("saveWav", "1");
                }
                pageUrl = u.toString();
            }
            catch {
                // Fall back to the known-good default if the URL is invalid.
                pageUrl = defaultPageUrl;
            }
        }
        await this.page.goto(pageUrl, { waitUntil: "load", timeout: 15000 });
        logging_1.logger.info({ event: "BOT_PAGE_LOADED", url: pageUrl }, "Bot page loaded");
        const userAgent = await this.page.evaluate("navigator.userAgent");
        logging_1.logger.info({ event: "BOT_PAGE_USER_AGENT", userAgent }, "Bot page user agent");
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Headless bot page did not connect to bridge within " + BRIDGE_CONNECT_TIMEOUT_MS / 1000 + "s")), BRIDGE_CONNECT_TIMEOUT_MS);
        });
        await Promise.race([bridgeConnectedPromise, timeoutPromise]).catch((err) => {
            logging_1.logger.error({ event: "BOT_BRIDGE_CONNECT_TIMEOUT", timeoutMs: BRIDGE_CONNECT_TIMEOUT_MS }, err.message);
            throw err;
        });
        logging_1.logger.info({ event: "BOT_BRIDGE_CONNECTED" }, "Bot page connected to bridge");
    }
}
exports.JitsiBrowserBot = JitsiBrowserBot;
//# sourceMappingURL=jitsi-browser-bot.js.map