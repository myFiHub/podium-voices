/**
 * Coordinator client: used by each agent process to sync turns, request turn, and end turn.
 * When COORDINATOR_URL is unset, the agent runs in single-agent mode (no coordinator calls).
 */
import type { CoordinatorTurn } from "./types";
/** Interface for turn coordination (implemented by CoordinatorClient). */
export interface ICoordinatorClient {
    syncRecentTurns(): Promise<CoordinatorTurn[]>;
    requestTurn(transcript: string): Promise<boolean>;
    endTurn(userMessage: string, assistantMessage: string): Promise<void>;
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
    /** POST /request-turn then poll GET /turn-decision until decided; return whether this agent is allowed. */
    requestTurn(transcript: string): Promise<boolean>;
    /** POST /end-turn: notify coordinator we finished our reply (clears currentSpeaker, appends turn). */
    endTurn(userMessage: string, assistantMessage: string): Promise<void>;
    private fetch;
}
//# sourceMappingURL=client.d.ts.map