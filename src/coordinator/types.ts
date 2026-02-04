/**
 * Types for the Turn Coordinator (multi-agent Phase 1).
 */

export interface CoordinatorTurn {
  user: string;
  assistant: string;
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
}

export interface PendingEntry {
  agentId: string;
  displayName: string;
}

export interface PendingBucket {
  entries: PendingEntry[];
  transcript: string;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}
