/**
 * In-memory session buffer: rolling transcript with max turn count.
 * Optional running summary hook for long sessions (e.g. 4h); MVP uses turns only.
 */

import type { MemoryTurn, SessionMemorySnapshot, ISessionMemory } from "./types";

export interface SessionMemoryConfig {
  /** Max number of recent turns to keep. */
  maxTurns: number;
}

export class SessionMemory implements ISessionMemory {
  private turns: MemoryTurn[] = [];
  private runningSummary: string | undefined;
  private readonly maxTurns: number;

  constructor(config: SessionMemoryConfig) {
    this.maxTurns = config.maxTurns;
  }

  append(role: "user" | "assistant", content: string): void {
    if (!content.trim()) return;
    this.turns.push({
      role,
      content: content.trim(),
      timestamp: Date.now(),
    });
    while (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }
  }

  getSnapshot(): SessionMemorySnapshot {
    return {
      turns: [...this.turns],
      runningSummary: this.runningSummary,
    };
  }

  clear(): void {
    this.turns = [];
    this.runningSummary = undefined;
  }

  /** Optional: set a running summary (e.g. from a background summarizer). */
  setRunningSummary(summary: string | undefined): void {
    this.runningSummary = summary;
  }
}
