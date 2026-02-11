"use strict";
/**
 * Importance-score auction: choose which agent gets the floor when multiple bid.
 * Rules: (1) explicit name-addressing overrides; (2) cooldown/fairness; (3) highest score; (4) tie-break.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BID_INTENTS = void 0;
exports.normalizeBid = normalizeBid;
exports.runAward = runAward;
exports.BID_INTENTS = ["hype", "clarify", "counter", "summarize", "answer"];
const DEFAULT_SCORE = 5;
const MIN_SCORE = 0;
const MAX_SCORE = 10;
function clampScore(n) {
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Number.isFinite(n) ? n : DEFAULT_SCORE));
}
function clampConfidence(n) {
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));
}
/** Normalize and validate a bid from the wire. */
function normalizeBid(raw) {
    const def = { score: DEFAULT_SCORE, intent: "answer", confidence: 0.5, target: null };
    if (raw == null || typeof raw !== "object")
        return def;
    const o = raw;
    return {
        score: "score" in o ? clampScore(Number(o.score)) : def.score,
        intent: typeof o.intent === "string" && exports.BID_INTENTS.includes(o.intent) ? o.intent : def.intent,
        confidence: "confidence" in o ? clampConfidence(Number(o.confidence)) : def.confidence,
        target: typeof o.target === "string" && o.target.trim().length > 0 ? o.target.trim() : def.target,
    };
}
/**
 * Pick winner from entries that have bids (or all entries when no bids).
 * transcriptLower: transcript lowercased for name matching.
 * lastSpeakerId: agent who spoke last (for cooldown); null if none.
 * agentOrderIds: preferred order for tie-break / round-robin.
 */
function runAward(entries, transcriptLower, lastSpeakerId, agentOrderIds) {
    if (entries.length === 0)
        throw new Error("runAward: no entries");
    const order = agentOrderIds.length > 0 ? agentOrderIds : entries.map((e) => e.agentId);
    // (1) Explicit addressing: if transcript contains an agent's display name, that agent wins.
    for (const e of entries) {
        const name = (e.displayName || "").toLowerCase();
        if (name && transcriptLower.includes(name)) {
            return { winnerId: e.agentId, reason: "name_addressing" };
        }
    }
    // (2) Cooldown: if we have a last speaker, prefer giving the turn to someone else (optional: skip for now to keep simple).
    // (3) Highest score; (4) tie-break by agent order.
    const withBids = entries.filter((e) => e.bid != null);
    const candidates = withBids.length > 0 ? withBids : entries.map((e) => ({ ...e, bid: normalizeBid(null) }));
    const scoreOf = (e) => (e.bid ? e.bid.score : DEFAULT_SCORE);
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const bScore = scoreOf(best);
        const cScore = scoreOf(c);
        if (cScore > bScore) {
            best = c;
            continue;
        }
        if (cScore === bScore) {
            const bIdx = order.indexOf(best.agentId);
            const cIdx = order.indexOf(c.agentId);
            if (cIdx >= 0 && (bIdx < 0 || cIdx < bIdx))
                best = c;
            else if (bIdx < 0 && cIdx < 0 && c.agentId < best.agentId)
                best = c;
        }
    }
    const usedBids = withBids.length > 0;
    return { winnerId: best.agentId, reason: usedBids ? "auction" : "round_robin" };
}
//# sourceMappingURL=auction.js.map