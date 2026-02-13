"use strict";
/**
 * Minimal HTTP health server for liveness and readiness (e.g. Kubernetes).
 * GET /health -> 200 if process is up.
 * GET /ready -> 200 only if getReady() returns true (WS connected and joined), else 503.
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
exports.startHealthServer = startHealthServer;
const http = __importStar(require("http"));
const logging_1 = require("./logging");
const DEFAULT_PORT = 8080;
function startHealthServer(options = {}) {
    const port = options.port ?? (parseInt(process.env.HEALTH_PORT ?? String(DEFAULT_PORT), 10) || DEFAULT_PORT);
    const getReady = options.getReady ?? (() => false);
    const server = http.createServer((req, res) => {
        const url = req.url ?? "";
        if (req.method === "GET" && (url === "/health" || url === "/")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (req.method === "GET" && url === "/ready") {
            const ready = getReady();
            const status = ready ? 200 : 503;
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: ready, ready }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    server.listen(port, () => {
        logging_1.logger.info({ event: "HEALTH_SERVER_STARTED", port }, "Health server listening");
    });
    return server;
}
//# sourceMappingURL=health-server.js.map