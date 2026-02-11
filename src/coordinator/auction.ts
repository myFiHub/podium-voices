/**
 * Importance-score auction: choose which agent gets the floor when multiple bid.
 * Rules: (1) explicit name-addressing overrides; (2) cooldown/fairness; (3) highest score; (4) tie-break.
 */

export const BID_INTENTS = ["hype", "clarify", "counter", "summarize", "answer"] as const;
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

const DEFAULT_SCORE = 5;
const MIN_SCORE = 0;
const MAX_SCORE = 10;

function clampScore(n: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Number.isFinite(n) ? n : DEFAULT_SCORE));
}

function clampConfidence(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));
}

/** Normalize and validate a bid from the wire. */
export function normalizeBid(raw: unknown): Bid {
  const def: Bid = { score: DEFAULT_SCORE, intent: "answer", confidence: 0.5, target: null };
  if (raw == null || typeof raw !== "object") return def;
  const o = raw as Record<string, unknown>;
  return {
    score: "score" in o ? clampScore(Number(o.score)) : def.score,
    intent: typeof o.intent === "string" && BID_INTENTS.includes(o.intent as BidIntent) ? o.intent : def.intent,
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
export function runAward(
  entries: BidEntry[],
  transcriptLower: string,
  lastSpeakerId: string | null,
  agentOrderIds: string[]
): AwardResult {
  if (entries.length === 0) throw new Error("runAward: no entries");

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
  const withBids = entries.filter((e) => e.bid != null) as (BidEntry & { bid: Bid })[];
  const candidates = withBids.length > 0 ? withBids : entries.map((e) => ({ ...e, bid: normalizeBid(null) }));

  const scoreOf = (e: BidEntry & { bid?: Bid }) => (e.bid ? e.bid.score : DEFAULT_SCORE);
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const bScore = scoreOf(best as BidEntry & { bid?: Bid });
    const cScore = scoreOf(c as BidEntry & { bid?: Bid });
    if (cScore > bScore) {
      best = c;
      continue;
    }
    if (cScore === bScore) {
      const bIdx = order.indexOf(best.agentId);
      const cIdx = order.indexOf(c.agentId);
      if (cIdx >= 0 && (bIdx < 0 || cIdx < bIdx)) best = c;
      else if (bIdx < 0 && cIdx < 0 && c.agentId < best.agentId) best = c;
    }
  }

  const usedBids = withBids.length > 0;
  return { winnerId: best.agentId, reason: usedBids ? "auction" : "round_robin" };
}
