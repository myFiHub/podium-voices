"use strict";
/**
 * In-memory session buffer: rolling transcript with max turn count.
 * Optional running summary hook for long sessions (e.g. 4h); MVP uses turns only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionMemory = void 0;
class SessionMemory {
    turns = [];
    runningSummary;
    maxTurns;
    constructor(config) {
        this.maxTurns = config.maxTurns;
    }
    append(role, content) {
        if (!content.trim())
            return;
        this.turns.push({
            role,
            content: content.trim(),
            timestamp: Date.now(),
        });
        while (this.turns.length > this.maxTurns) {
            this.turns.shift();
        }
    }
    getSnapshot() {
        return {
            turns: [...this.turns],
            runningSummary: this.runningSummary,
        };
    }
    clear() {
        this.turns = [];
        this.runningSummary = undefined;
    }
    /** Optional: set a running summary (e.g. from a background summarizer). */
    setRunningSummary(summary) {
        this.runningSummary = summary;
    }
}
exports.SessionMemory = SessionMemory;
//# sourceMappingURL=session.js.map