/**
 * Running summary: every N turns, summarize recent dialogue and persist.
 * Runs async so it does not block the next user turn; single-flight lock.
 */

import * as fs from "fs";
import * as path from "path";
import type { ILLM } from "../adapters/llm";
import type { SessionMemorySnapshot } from "./types";
import { logger } from "../logging";

const SUMMARY_MAX_TOKENS = 250;
const TURNS_FOR_SUMMARY = 12;

let summarizerBusy = false;

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
export async function updateRunningSummary(
  memory: { getSnapshot(): SessionMemorySnapshot; setRunningSummary(s: string | undefined): void },
  llm: ILLM,
  sessionId: string,
  options?: RunningSummaryOptions
): Promise<void> {
  if (summarizerBusy) return;
  summarizerBusy = true;
  const turnsInPrompt = options?.turnsInPrompt ?? TURNS_FOR_SUMMARY;
  const maxTokens = options?.maxTokens ?? SUMMARY_MAX_TOKENS;
  const sessionsDir = options?.sessionsDir ?? path.join(process.cwd(), "data", "sessions");

  try {
    const snapshot = memory.getSnapshot();
    const previousSummary = snapshot.runningSummary;
    const turns = snapshot.turns.slice(-turnsInPrompt);
    if (turns.length === 0) {
      return;
    }

    const turnsBlob = turns.map((t) => `${t.role}: ${t.content}`).join("\n");
    const system =
      "You are a summarizer. Output a concise running summary (5–10 bullets) of the conversation so far: main claims, open questions, audience sentiment, suggested next step. No preamble.";
    const user = previousSummary
      ? `Previous summary:\n${previousSummary}\n\nRecent turns:\n${turnsBlob}\n\nUpdate the running summary.`
      : `Recent turns:\n${turnsBlob}\n\nProduce the running summary.`;

    const response = await llm.chat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { stream: false, maxTokens }
    );
    const newSummary = (response.text || "").trim();
    if (!newSummary) return;

    memory.setRunningSummary(newSummary);

    try {
      fs.mkdirSync(sessionsDir, { recursive: true });
      const filePath = path.join(sessionsDir, `${sessionId}.json`);
      const payload = JSON.stringify(
        { sessionId, summary: newSummary, updated_at: new Date().toISOString() },
        null,
        2
      );
      fs.writeFileSync(filePath, payload, "utf8");
      logger.debug({ event: "RUNNING_SUMMARY_PERSISTED", sessionId, path: filePath }, "Running summary persisted");
    } catch (err) {
      logger.warn({ event: "RUNNING_SUMMARY_PERSIST_FAILED", sessionId, err: (err as Error).message }, "Failed to persist running summary");
    }
  } catch (err) {
    logger.warn({ event: "RUNNING_SUMMARY_FAILED", sessionId, err: (err as Error).message }, "Running summary update failed");
  } finally {
    summarizerBusy = false;
  }
}
