/**
 * Types for the Turn Coordinator (multi-agent Phase 1).
 */

export interface CoordinatorTurn {
  user: string;
  assistant: string;
}

/** Time-bounded grant: winner holds floor until expiry or end-turn. */
export interface TurnLease {
  turnId: string;
  leaseMs: number;
  expiresAt: number;
}

export interface RequestTurnBody {
  agentId: string;
  displayName?: string;
  transcript: string;
  requestId: string;
}

export interface EndTurnBody {
  agentId: string;
  userMessage: string;
  assistantMessage: string;
  /** Required when coordinator uses leases; must match current lease to clear. */
  turnId?: string;
}

export interface AgentBid {
  score: number;
  intent: string;
  confidence: number;
  target: string | null;
}

export interface PendingEntry {
  agentId: string;
  displayName: string;
  bid?: AgentBid;
}

export interface PendingBucket {
  entries: PendingEntry[];
  transcript: string;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** Per-request decision: which agent is allowed and lease info for winner. */
export interface TurnDecisionValue {
  allowed: Record<string, boolean>;
  turnId?: string;
  leaseMs?: number;
  winnerSelectionReason?: string;
}
