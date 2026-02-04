/**
 * Session memory types for the AI co-host.
 * Rolling transcript + optional running summary for long sessions.
 */

export interface MemoryTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface SessionMemorySnapshot {
  /** Recent turns (within token/turn limit). */
  turns: MemoryTurn[];
  /** Optional running summary of older context (for 4h sessions). */
  runningSummary?: string;
}

export interface ISessionMemory {
  /** Append a user or assistant turn. */
  append(role: "user" | "assistant", content: string): void;

  /** Get recent turns + optional summary for LLM context. */
  getSnapshot(): SessionMemorySnapshot;

  /** Clear all (e.g. new session). */
  clear(): void;

  /** Replace in-memory turns with external list (e.g. from Turn Coordinator). Optional for multi-agent sync. */
  replaceTurns?(turns: Array<{ role: "user" | "assistant"; content: string }>): void;
}
