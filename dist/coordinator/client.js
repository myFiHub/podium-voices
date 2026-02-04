"use strict";
/**
 * Coordinator client: used by each agent process to sync turns, request turn, and end turn.
 * When COORDINATOR_URL is unset, the agent runs in single-agent mode (no coordinator calls).
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
exports.CoordinatorClient = void 0;
exports.computeRequestId = computeRequestId;
const crypto = __importStar(require("crypto"));
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_DECISION_TIMEOUT_MS = 5000;
/** Normalize transcript for deterministic requestId (same utterance => same id). */
function normalizeTranscript(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}
/** Deterministic requestId so all agents use the same key for the same user utterance. */
function computeRequestId(transcript) {
    return crypto.createHash("sha256").update(normalizeTranscript(transcript)).digest("hex");
}
class CoordinatorClient {
    baseUrl;
    agentId;
    displayName;
    pollIntervalMs;
    decisionTimeoutMs;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, "");
        this.agentId = config.agentId;
        this.displayName = config.displayName;
        this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.decisionTimeoutMs = config.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
    }
    /** GET /recent-turns: fetch shared conversation so agent can sync local memory. */
    async syncRecentTurns() {
        try {
            const res = await this.fetch("/recent-turns");
            if (!res.ok)
                return [];
            const data = (await res.json());
            return Array.isArray(data.turns) ? data.turns : [];
        }
        catch {
            return [];
        }
    }
    /** POST /request-turn then poll GET /turn-decision until decided; return whether this agent is allowed. */
    async requestTurn(transcript) {
        const requestId = computeRequestId(transcript);
        let postRes;
        try {
            postRes = await this.fetch("/request-turn", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentId: this.agentId,
                    displayName: this.displayName,
                    transcript,
                    requestId,
                }),
            });
        }
        catch {
            return false;
        }
        if (!postRes.ok)
            return false;
        const postData = (await postRes.json());
        if (postData.pending === false && postData.allowed === false)
            return false;
        if (postData.allowed === true)
            return true;
        const deadline = Date.now() + this.decisionTimeoutMs;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, this.pollIntervalMs));
            const getRes = await this.fetch(`/turn-decision?requestId=${encodeURIComponent(requestId)}&agentId=${encodeURIComponent(this.agentId)}`);
            if (!getRes.ok)
                continue;
            const getData = (await getRes.json());
            if (getData.decided)
                return getData.allowed === true;
        }
        return false;
    }
    /** POST /end-turn: notify coordinator we finished our reply (clears currentSpeaker, appends turn). */
    async endTurn(userMessage, assistantMessage) {
        await this.fetch("/end-turn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                agentId: this.agentId,
                userMessage,
                assistantMessage,
            }),
        });
    }
    async fetch(path, init) {
        return fetch(`${this.baseUrl}${path}`, init);
    }
}
exports.CoordinatorClient = CoordinatorClient;
//# sourceMappingURL=client.js.map