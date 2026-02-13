/**
 * Running summary: every N turns, summarize recent dialogue and persist.
 * Runs async so it does not block the next user turn; single-flight lock.
 */
import type { ILLM } from "../adapters/llm";
import type { SessionMemorySnapshot } from "./types";
export interface RunningSummaryOptions {
    /** How many recent turns to include in the summary prompt (default 12). */
    turnsInPrompt?: number;
    /** Max tokens for the summary response (default 250). */
    maxTokens?: number;
    /** Directory to write session JSON (default ./data/sessions). */
    sessionsDir?: string;
}
/**
 * Build a short running summary from the last M turns and optional previous summary.
 * Calls LLM non-streaming, then updates memory and persists to disk.
 * Safe to call from orchestrator after each assistant turn; only one run at a time.
 */
export declare function updateRunningSummary(memory: {
    getSnapshot(): SessionMemorySnapshot;
    setRunningSummary(s: string | undefined): void;
}, llm: ILLM, sessionId: string, options?: RunningSummaryOptions): Promise<void>;
//# sourceMappingURL=running-summary.d.ts.map