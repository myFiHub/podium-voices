"use strict";
/**
 * Running summary: every N turns, summarize recent dialogue and persist.
 * Runs async so it does not block the next user turn; single-flight lock.
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
exports.updateRunningSummary = updateRunningSummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logging_1 = require("../logging");
const SUMMARY_MAX_TOKENS = 250;
const TURNS_FOR_SUMMARY = 12;
let summarizerBusy = false;
/**
 * Build a short running summary from the last M turns and optional previous summary.
 * Calls LLM non-streaming, then updates memory and persists to disk.
 * Safe to call from orchestrator after each assistant turn; only one run at a time.
 */
async function updateRunningSummary(memory, llm, sessionId, options) {
    if (summarizerBusy)
        return;
    summarizerBusy = true;
    const turnsInPrompt = options?.turnsInPrompt ?? TURNS_FOR_SUMMARY;
    const maxTokens = options?.maxTokens ?? SUMMARY_MAX_TOKENS;
    const sessionsDir = options?.sessionsDir ?? path.join(process.cwd(), "data", "sessions");
    try {
        const snapshot = memory.getSnapshot();
        const previousSummary = snapshot.runningSummary;
        const turns = snapshot.turns.slice(-turnsInPrompt);
        if (turns.length === 0) {
            return;
        }
        const turnsBlob = turns.map((t) => `${t.role}: ${t.content}`).join("\n");
        const system = "You are a summarizer. Output a concise running summary (5–10 bullets) of the conversation so far: main claims, open questions, audience sentiment, suggested next step. No preamble.";
        const user = previousSummary
            ? `Previous summary:\n${previousSummary}\n\nRecent turns:\n${turnsBlob}\n\nUpdate the running summary.`
            : `Recent turns:\n${turnsBlob}\n\nProduce the running summary.`;
        const response = await llm.chat([{ role: "system", content: system }, { role: "user", content: user }], { stream: false, maxTokens });
        const newSummary = (response.text || "").trim();
        if (!newSummary)
            return;
        memory.setRunningSummary(newSummary);
        try {
            fs.mkdirSync(sessionsDir, { recursive: true });
            const filePath = path.join(sessionsDir, `${sessionId}.json`);
            const payload = JSON.stringify({ sessionId, summary: newSummary, updated_at: new Date().toISOString() }, null, 2);
            fs.writeFileSync(filePath, payload, "utf8");
            logging_1.logger.debug({ event: "RUNNING_SUMMARY_PERSISTED", sessionId, path: filePath }, "Running summary persisted");
        }
        catch (err) {
            logging_1.logger.warn({ event: "RUNNING_SUMMARY_PERSIST_FAILED", sessionId, err: err.message }, "Failed to persist running summary");
        }
    }
    catch (err) {
        logging_1.logger.warn({ event: "RUNNING_SUMMARY_FAILED", sessionId, err: err.message }, "Running summary update failed");
    }
    finally {
        summarizerBusy = false;
    }
}
//# sourceMappingURL=running-summary.js.map