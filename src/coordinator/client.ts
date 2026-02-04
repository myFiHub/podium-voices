/**
 * Coordinator client: used by each agent process to sync turns, request turn, and end turn.
 * When COORDINATOR_URL is unset, the agent runs in single-agent mode (no coordinator calls).
 */

import * as crypto from "crypto";
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

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_DECISION_TIMEOUT_MS = 5000;

/** Normalize transcript for deterministic requestId (same utterance => same id). */
function normalizeTranscript(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic requestId so all agents use the same key for the same user utterance. */
export function computeRequestId(transcript: string): string {
  return crypto.createHash("sha256").update(normalizeTranscript(transcript)).digest("hex");
}

export class CoordinatorClient implements ICoordinatorClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly displayName: string;
  private readonly pollIntervalMs: number;
  private readonly decisionTimeoutMs: number;

  constructor(config: CoordinatorClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.agentId = config.agentId;
    this.displayName = config.displayName;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.decisionTimeoutMs = config.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
  }

  /** GET /recent-turns: fetch shared conversation so agent can sync local memory. */
  async syncRecentTurns(): Promise<CoordinatorTurn[]> {
    try {
      const res = await this.fetch("/recent-turns");
      if (!res.ok) return [];
      const data = (await res.json()) as { turns?: CoordinatorTurn[] };
      return Array.isArray(data.turns) ? data.turns : [];
    } catch {
      return [];
    }
  }

  /** POST /request-turn then poll GET /turn-decision until decided; return whether this agent is allowed. */
  async requestTurn(transcript: string): Promise<boolean> {
    const requestId = computeRequestId(transcript);
    let postRes: Response;
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
    } catch {
      return false;
    }
    if (!postRes.ok) return false;
    const postData = (await postRes.json()) as { pending?: boolean; allowed?: boolean };
    if (postData.pending === false && postData.allowed === false) return false;
    if (postData.allowed === true) return true;

    const deadline = Date.now() + this.decisionTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const getRes = await this.fetch(
        `/turn-decision?requestId=${encodeURIComponent(requestId)}&agentId=${encodeURIComponent(this.agentId)}`
      );
      if (!getRes.ok) continue;
      const getData = (await getRes.json()) as { decided?: boolean; allowed?: boolean };
      if (getData.decided) return getData.allowed === true;
    }
    return false;
  }

  /** POST /end-turn: notify coordinator we finished our reply (clears currentSpeaker, appends turn). */
  async endTurn(userMessage: string, assistantMessage: string): Promise<void> {
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

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, init);
  }
}
