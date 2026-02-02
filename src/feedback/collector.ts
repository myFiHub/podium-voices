/**
 * Feedback collector: map Podium WebSocket reaction events and/or live data to sentiment.
 * Subscribe to WS "reactions" and optionally poll getLatestLiveData; expose getSentiment() for the orchestrator.
 */

import type { FeedbackSentiment, FeedbackState } from "./types";
import type { WSInMessage } from "../room/types";
import { WS_INCOMING_NAMES } from "../room/types";

const WINDOW_MS = 60_000;

export interface FeedbackCollectorConfig {
  /** How long to keep reaction counts (ms). */
  windowMs?: number;
}

export class FeedbackCollector {
  private cheers = 0;
  private boos = 0;
  private likes = 0;
  private dislikes = 0;
  private lastUpdated = 0;
  private readonly windowMs: number;

  constructor(config: FeedbackCollectorConfig = {}) {
    this.windowMs = config.windowMs ?? WINDOW_MS;
  }

  /**
   * Handle incoming WebSocket message (e.g. reactions).
   * Podium sends { name: "reactions", data: { ... } }. Adjust counts based on message_type or data shape.
   */
  handleWSMessage(msg: WSInMessage): void {
    if (msg.name !== WS_INCOMING_NAMES.REACTIONS) return;
    const data = msg.data as Record<string, unknown> | undefined;
    if (!data) return;
    const now = Date.now();
    this.prune(now);
    if (data.type === "CHEER" || data.reaction === "cheer") this.cheers++;
    if (data.type === "BOO" || data.reaction === "boo") this.boos++;
    if (data.type === "LIKE" || data.reaction === "like") this.likes++;
    if (data.type === "DISLIKE" || data.reaction === "dislike") this.dislikes++;
    this.lastUpdated = now;
  }

  /**
   * Update from LiveMember[] (e.g. from getLatestLiveData). Aggregate feedbacks/reactions if present.
   */
  updateFromLiveMembers(members: Array<{ feedbacks?: unknown; reactions?: unknown }>): void {
    const now = Date.now();
    this.prune(now);
    for (const m of members) {
      const reactions = m.reactions as Record<string, number> | undefined;
      if (reactions) {
        if (reactions.cheer) this.cheers += Number(reactions.cheer);
        if (reactions.boo) this.boos += Number(reactions.boo);
        if (reactions.like) this.likes += Number(reactions.like);
        if (reactions.dislike) this.dislikes += Number(reactions.dislike);
      }
    }
    this.lastUpdated = now;
  }

  /** Get current sentiment for the orchestrator (cheer | boo | neutral). */
  getSentiment(): FeedbackSentiment {
    this.prune(Date.now());
    if (this.cheers > this.boos && (this.cheers > 0 || this.likes > this.dislikes)) return "cheer";
    if (this.boos > this.cheers || this.dislikes > this.likes) return "boo";
    return "neutral";
  }

  getState(): FeedbackState {
    this.prune(Date.now());
    return {
      sentiment: this.getSentiment(),
      cheers: this.cheers,
      boos: this.boos,
      likes: this.likes,
      dislikes: this.dislikes,
      lastUpdated: this.lastUpdated,
    };
  }

  private prune(now: number): void {
    if (now - this.lastUpdated > this.windowMs) {
      this.cheers = 0;
      this.boos = 0;
      this.likes = 0;
      this.dislikes = 0;
      this.lastUpdated = now;
    }
  }
}
