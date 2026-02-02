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
const audio_bridge_protocol_1 = require("./audio-bridge-protocol");
const logging_1 = require("../logging");
const DEFAULT_BRIDGE_PORT = 8766;
const BRIDGE_PORT_RETRY_COUNT = 5;
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
    closed = false;
    rxBytesTotal = 0;
    txBytesTotal = 0;
    lastRxTxAt = 0;
    constructor(config) {
        this.config = config;
    }
    onIncomingAudio(callback) {
        this.onIncomingAudioCb = callback;
    }
    pushAudio(buffer) {
        if (this.closed || !this.ws || this.ws.readyState !== 1)
            return;
        this.txBuffer = Buffer.concat([this.txBuffer, buffer]);
        const frames = (0, audio_bridge_protocol_1.chunk48k20ms)(this.txBuffer);
        const consumed = frames.length * audio_bridge_protocol_1.BRIDGE_FRAME_BYTES;
        this.txBuffer = consumed >= this.txBuffer.length ? Buffer.alloc(0) : this.txBuffer.subarray(consumed);
        for (const frame of frames) {
            this.ws.send(frame);
            this.txBytesTotal += frame.length;
            this.lastRxTxAt = Date.now();
        }
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
        if (!bound)
            throw new Error("Could not bind bridge to any port in [" + startPort + ".." + maxPort + "]");
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
                }
                catch {
                    // ignore non-JSON or parse errors
                }
            });
            ws.on("close", () => { this.ws = null; });
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
            logging_1.logger.warn({ event: "BOT_PAGE_ERROR", message: err.message }, "Bot page JS error: " + err.message);
        });
        this.page.on("console", (msg) => {
            const text = msg.text();
            const type = msg.type();
            logging_1.logger.info({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
        });
        this.page.on("websocket", (ws) => {
            logging_1.logger.info({ event: "PW_WEBSOCKET_CREATED", url: ws.url() }, "Playwright: WebSocket created");
            ws.on("framesent", (e) => logging_1.logger.debug({ event: "PW_WS_SENT", payload: e.payload }, "PW WS sent"));
            ws.on("framereceived", (e) => logging_1.logger.debug({ event: "PW_WS_RECV", payload: e.payload }, "PW WS recv"));
            ws.on("close", () => logging_1.logger.info({ event: "PW_WS_CLOSE" }, "Playwright: WebSocket closed"));
        });
        const pageUrl = this.config.botPageUrl || `http://127.0.0.1:${this.bridgePort}/bot.html?ws=ws://127.0.0.1:${this.bridgePort}/bridge`;
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