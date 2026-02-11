/**
 * Importance-score auction: choose which agent gets the floor when multiple bid.
 * Rules: (1) explicit name-addressing overrides; (2) cooldown/fairness; (3) highest score; (4) tie-break.
 */
export declare const BID_INTENTS: readonly ["hype", "clarify", "counter", "summarize", "answer"];
export type BidIntent = (typeof BID_INTENTS)[number];
export interface Bid {
    score: number;
    intent: string;
    confidence: number;
    /** User-addressed name (e.g. "alex"); overrides score when present in transcript. */
    target: string | null;
}
export type WinnerSelectionReason = "name_addressing" | "round_robin" | "auction";
export interface AwardResult {
    winnerId: string;
    reason: WinnerSelectionReason;
}
export interface BidEntry {
    agentId: string;
    displayName: string;
    bid?: Bid;
}
/** Normalize and validate a bid from the wire. */
export declare function normalizeBid(raw: unknown): Bid;
/**
 * Pick winner from entries that have bids (or all entries when no bids).
 * transcriptLower: transcript lowercased for name matching.
 * lastSpeakerId: agent who spoke last (for cooldown); null if none.
 * agentOrderIds: preferred order for tie-break / round-robin.
 */
export declare function runAward(entries: BidEntry[], transcriptLower: string, lastSpeakerId: string | null, agentOrderIds: string[]): AwardResult;
//# sourceMappingURL=auction.d.ts.map