"use strict";
/**
 * Turn Coordinator: HTTP service for multi-agent turn-taking.
 * Run as a separate process. Agents GET /recent-turns, POST /request-turn, poll GET /turn-decision, POST /end-turn.
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
exports.server = void 0;
const http = __importStar(require("http"));
const DEFAULT_PORT = 3001;
const DEFAULT_COLLECTION_MS = 300;
const MAX_RECENT_TURNS = 50;
function getEnv(key, defaultValue) {
    const v = process.env[key];
    if (v === undefined || v === "")
        return defaultValue;
    return v.trim();
}
/** Collection window (ms) before turn decision; from COORDINATOR_COLLECTION_MS (default 300). */
function getCollectionMs() {
    const s = getEnv("COORDINATOR_COLLECTION_MS");
    if (s === undefined)
        return DEFAULT_COLLECTION_MS;
    const n = parseInt(s, 10);
    return Number.isNaN(n) || n < 0 ? DEFAULT_COLLECTION_MS : Math.min(n, 60_000);
}
/** Parse COORDINATOR_AGENTS=alex:Alex,jamie:Jamie into ordered [{ id, displayName }]. */
function parseAgentsConfig(s) {
    if (!s)
        return [];
    return s.split(",").map((pair) => {
        const [id, displayName] = pair.split(":").map((x) => x.trim());
        return { agentId: id || "unknown", displayName: displayName || id || "unknown" };
    });
}
const agentsOrder = parseAgentsConfig(getEnv("COORDINATOR_AGENTS"));
const agentOrderIds = agentsOrder.map((a) => a.agentId);
const discoveredOrder = [];
let currentSpeaker = null;
let lastRespondentIndex = -1;
const recentTurns = [];
const pendingRequests = new Map();
const decisions = new Map();
function runSelection(_requestId, bucket) {
    const transcriptLower = bucket.transcript.toLowerCase();
    const requestedEntries = bucket.entries;
    for (const entry of requestedEntries) {
        const name = (entry.displayName || "").toLowerCase();
        if (name && transcriptLower.includes(name)) {
            return entry.agentId;
        }
    }
    const order = agentOrderIds.length > 0 ? agentOrderIds : discoveredOrder;
    if (order.length > 0 && requestedEntries.length > 0) {
        for (let i = 1; i <= order.length; i++) {
            const nextIndex = (lastRespondentIndex + i) % order.length;
            const nextId = order[nextIndex];
            if (requestedEntries.some((e) => e.agentId === nextId)) {
                lastRespondentIndex = nextIndex;
                return nextId;
            }
        }
    }
    if (agentOrderIds.length === 0) {
        for (const e of requestedEntries) {
            if (!discoveredOrder.includes(e.agentId))
                discoveredOrder.push(e.agentId);
        }
    }
    lastRespondentIndex = (lastRespondentIndex + 1) % Math.max(1, requestedEntries.length);
    return requestedEntries[lastRespondentIndex % requestedEntries.length]?.agentId ?? requestedEntries[0].agentId;
}
function flushRequest(requestId) {
    const bucket = pendingRequests.get(requestId);
    if (!bucket)
        return;
    if (bucket.timer)
        clearTimeout(bucket.timer);
    pendingRequests.delete(requestId);
    if (currentSpeaker !== null) {
        decisions.set(requestId, Object.fromEntries(bucket.entries.map((e) => [e.agentId, false])));
        return;
    }
    const chosenId = runSelection(requestId, bucket);
    currentSpeaker = chosenId;
    const decision = {};
    for (const e of bucket.entries) {
        decision[e.agentId] = e.agentId === chosenId;
    }
    decisions.set(requestId, decision);
}
function scheduleFlush(requestId) {
    const bucket = pendingRequests.get(requestId);
    if (!bucket || bucket.timer)
        return;
    const collectionMs = getCollectionMs();
    const timer = setTimeout(() => {
        flushRequest(requestId);
    }, collectionMs);
    bucket.timer = timer;
    timer.unref?.();
}
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                const body = Buffer.concat(chunks).toString("utf8");
                resolve(body ? JSON.parse(body) : {});
            }
            catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}
function sendJson(res, status, data) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(status);
    res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "";
    if (method === "GET" && (url === "/recent-turns" || url.startsWith("/recent-turns?"))) {
        sendJson(res, 200, { turns: recentTurns, maxTurns: MAX_RECENT_TURNS });
        return;
    }
    if (method === "GET" && url.startsWith("/turn-decision")) {
        const u = new URL(url, "http://localhost");
        const requestId = u.searchParams.get("requestId") ?? "";
        const agentId = u.searchParams.get("agentId") ?? "";
        const decision = decisions.get(requestId);
        if (!decision) {
            sendJson(res, 200, { decided: false });
            return;
        }
        const allowed = decision[agentId];
        sendJson(res, 200, { decided: true, allowed: allowed === true });
        return;
    }
    if (method === "POST" && url === "/request-turn") {
        let body;
        try {
            body = await parseJsonBody(req);
        }
        catch {
            sendJson(res, 400, { error: "Invalid JSON body" });
            return;
        }
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        const displayName = typeof body.displayName === "string" ? body.displayName : agentId;
        const transcript = typeof body.transcript === "string" ? body.transcript : "";
        const requestId = typeof body.requestId === "string" ? body.requestId : "";
        if (!agentId || !requestId) {
            sendJson(res, 400, { error: "Missing agentId or requestId" });
            return;
        }
        if (currentSpeaker !== null) {
            sendJson(res, 200, { pending: false, allowed: false });
            return;
        }
        let bucket = pendingRequests.get(requestId);
        if (!bucket) {
            bucket = { entries: [], transcript, createdAt: Date.now() };
            pendingRequests.set(requestId, bucket);
            scheduleFlush(requestId);
        }
        if (!bucket.entries.some((e) => e.agentId === agentId)) {
            bucket.entries.push({ agentId, displayName });
        }
        sendJson(res, 200, { pending: true });
        return;
    }
    if (method === "POST" && url === "/end-turn") {
        let body;
        try {
            body = await parseJsonBody(req);
        }
        catch {
            sendJson(res, 400, { error: "Invalid JSON body" });
            return;
        }
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        const userMessage = typeof body.userMessage === "string" ? body.userMessage : "";
        const assistantMessage = typeof body.assistantMessage === "string" ? body.assistantMessage : "";
        if (!agentId) {
            sendJson(res, 400, { error: "Missing agentId" });
            return;
        }
        currentSpeaker = null;
        recentTurns.push({ user: userMessage, assistant: assistantMessage });
        while (recentTurns.length > MAX_RECENT_TURNS) {
            recentTurns.shift();
        }
        sendJson(res, 200, { ok: true });
        return;
    }
    res.writeHead(404);
    res.end();
});
exports.server = server;
const port = parseInt(getEnv("COORDINATOR_PORT") ?? String(DEFAULT_PORT), 10);
const listenPort = Number.isNaN(port) ? DEFAULT_PORT : port;
server.listen(listenPort, () => {
    console.log(`Turn Coordinator listening on port ${listenPort}`);
});
//# sourceMappingURL=index.js.map