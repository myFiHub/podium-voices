/**
 * Coordinator client: used by each agent process to sync turns, request turn, and end turn.
 * When COORDINATOR_URL is unset, the agent runs in single-agent mode (no coordinator calls).
 */
import type { CoordinatorTurn } from "./types";
/** Stub bid for auction (orchestrator can pass when coordinator is used). */
export interface CoordinatorBid {
    score: number;
    intent: string;
    confidence: number;
    target: string | null;
}
/** Result of requestTurn: when allowed, turnId and leaseMs are set for end-turn. */
export interface RequestTurnResult {
    allowed: boolean;
    turnId?: string;
    leaseMs?: number;
    winnerSelectionReason?: string;
}
/** Interface for turn coordination (implemented by CoordinatorClient). */
export interface ICoordinatorClient {
    syncRecentTurns(): Promise<CoordinatorTurn[]>;
    requestTurn(transcript: string, bid?: CoordinatorBid): Promise<RequestTurnResult>;
    endTurn(userMessage: string, assistantMessage: string, turnId?: string): Promise<void>;
}
export interface CoordinatorClientConfig {
    baseUrl: string;
    agentId: string;
    displayName: string;
    /** Poll interval for turn-decision (ms). */
    pollIntervalMs?: number;
    /** Max time to wait for a decision (ms). */
    decisionTimeoutMs?: number;
}
/** Deterministic requestId so all agents use the same key for the same user utterance. */
export declare function computeRequestId(transcript: string): string;
export declare class CoordinatorClient implements ICoordinatorClient {
    private readonly baseUrl;
    private readonly agentId;
    private readonly displayName;
    private readonly pollIntervalMs;
    private readonly decisionTimeoutMs;
    constructor(config: CoordinatorClientConfig);
    /** GET /recent-turns: fetch shared conversation so agent can sync local memory. */
    syncRecentTurns(): Promise<CoordinatorTurn[]>;
    /** POST /request-turn then poll GET /turn-decision until decided; optional bid for auction. */
    requestTurn(transcript: string, bid?: CoordinatorBid): Promise<RequestTurnResult>;
    /** POST /end-turn: notify coordinator we finished our reply. Pass turnId when present (lease-based). */
    endTurn(userMessage: string, assistantMessage: string, turnId?: string): Promise<void>;
    private fetch;
}
//# sourceMappingURL=client.d.ts.map