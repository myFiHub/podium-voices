/**
 * Feedback collector: map Podium WebSocket reaction events and/or live data to sentiment.
 * Subscribe to WS "reactions" and optionally poll getLatestLiveData; expose getSentiment() for the orchestrator.
 */

import type { FeedbackBehaviorLevel, FeedbackSentiment, FeedbackState, FeedbackThresholds } from "./types";
import { DEFAULT_FEEDBACK_THRESHOLDS } from "./types";
import type { WSInMessage } from "../room/types";
import { WS_INCOMING_NAMES } from "../room/types";

const WINDOW_MS = 60_000;

export interface FeedbackCollectorConfig {
  /** How long to keep reaction counts (ms). */
  windowMs?: number;
  /**
   * Optional: only count reactions that target this wallet address.
   * When unset, count all reactions (room mood).
   */
  reactToUserAddressFilter?: string;
}

export class FeedbackCollector {
  private cheers = 0;
  private boos = 0;
  private likes = 0;
  private dislikes = 0;
  private cheerAmount = 0;
  private booAmount = 0;
  private lastUpdated = 0;
  private readonly windowMs: number;
  private reactToUserAddressFilter?: string;

  constructor(config: FeedbackCollectorConfig = {}) {
    this.windowMs = config.windowMs ?? WINDOW_MS;
    this.setReactToUserAddressFilter(config.reactToUserAddressFilter);
  }

  /**
   * Optional: only count reactions that target this wallet address.
   * When unset, count all reactions (room mood).
   */
  setReactToUserAddressFilter(address?: string): void {
    const v = (address || "").trim();
    this.reactToUserAddressFilter = v ? v.toLowerCase() : undefined;
  }

  /**
   * Handle incoming WebSocket message (e.g. reactions).
   *
   * Podium/nexus sends one message per reaction:
   * - name: user.liked | user.disliked | user.booed | user.cheered
   * - data.react_to_user_address: wallet address of the user reacted to (the target)
   *
   * For backward compatibility, we also accept a legacy wrapper:
   * - name: reactions
   * - data.type or data.reaction: LIKE/DISLIKE/BOO/CHEER
   */
  handleWSMessage(msg: WSInMessage): void {
    const data = msg.data as Record<string, unknown> | undefined;
    if (!data) return;
    const now = Date.now();
    this.prune(now);

    // --- Preferred (nexus-compatible): one WS message per reaction ---
    if (
      msg.name === WS_INCOMING_NAMES.USER_LIKED ||
      msg.name === WS_INCOMING_NAMES.USER_DISLIKED ||
      msg.name === WS_INCOMING_NAMES.USER_BOOED ||
      msg.name === WS_INCOMING_NAMES.USER_CHEERED
    ) {
      const target = typeof data.react_to_user_address === "string" ? data.react_to_user_address.trim() : "";
      if (this.reactToUserAddressFilter && (!target || target.toLowerCase() !== this.reactToUserAddressFilter)) return;

      const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount : 0;

      if (msg.name === WS_INCOMING_NAMES.USER_CHEERED) {
        this.cheers++;
        if (amount > 0) this.cheerAmount += amount;
      }
      if (msg.name === WS_INCOMING_NAMES.USER_BOOED) {
        this.boos++;
        if (amount > 0) this.booAmount += amount;
      }
      if (msg.name === WS_INCOMING_NAMES.USER_LIKED) this.likes++;
      if (msg.name === WS_INCOMING_NAMES.USER_DISLIKED) this.dislikes++;

      this.lastUpdated = now;
      return;
    }

    // --- Legacy wrapper (if backend emits aggregated reaction events) ---
    if (msg.name === WS_INCOMING_NAMES.REACTIONS) {
      const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount : 0;
      if (data.type === "CHEER" || data.reaction === "cheer") {
        this.cheers++;
        if (amount > 0) this.cheerAmount += amount;
      }
      if (data.type === "BOO" || data.reaction === "boo") {
        this.boos++;
        if (amount > 0) this.booAmount += amount;
      }
      if (data.type === "LIKE" || data.reaction === "like") this.likes++;
      if (data.type === "DISLIKE" || data.reaction === "dislike") this.dislikes++;
      this.lastUpdated = now;
    }
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

  /**
   * Derive a behavior level from the reaction register using thresholds.
   * Negative levels are checked first so the agent is biased toward de-escalation.
   */
  getBehaviorLevel(thresholds: FeedbackThresholds = DEFAULT_FEEDBACK_THRESHOLDS): FeedbackBehaviorLevel {
    this.prune(Date.now());

    const meetsHighPositive =
      (thresholds.highPositive.minCheers != null && this.cheers >= thresholds.highPositive.minCheers) ||
      (thresholds.highPositive.minLikes != null && this.likes >= thresholds.highPositive.minLikes);

    const meetsPositive =
      (thresholds.positive.minCheers != null && this.cheers >= thresholds.positive.minCheers) ||
      (thresholds.positive.minLikes != null && this.likes >= thresholds.positive.minLikes);

    const meetsHighNegative =
      (thresholds.highNegative.minBoos != null && this.boos >= thresholds.highNegative.minBoos) ||
      (thresholds.highNegative.minDislikes != null && this.dislikes >= thresholds.highNegative.minDislikes);

    const meetsNegative =
      (thresholds.negative.minBoos != null && this.boos >= thresholds.negative.minBoos) ||
      (thresholds.negative.minDislikes != null && this.dislikes >= thresholds.negative.minDislikes);

    // Prefer negative levels over positive when both are true (bias toward de-escalation).
    if (meetsHighNegative) return "high_negative";
    if (meetsNegative) return "negative";
    if (meetsHighPositive) return "high_positive";
    if (meetsPositive) return "positive";
    return "neutral";
  }

  getState(): FeedbackState {
    this.prune(Date.now());
    return {
      sentiment: this.getSentiment(),
      behaviorLevel: this.getBehaviorLevel(),
      cheers: this.cheers,
      boos: this.boos,
      likes: this.likes,
      dislikes: this.dislikes,
      cheerAmount: this.cheerAmount,
      booAmount: this.booAmount,
      lastUpdated: this.lastUpdated,
    };
  }

  private prune(now: number): void {
    if (now - this.lastUpdated > this.windowMs) {
      this.cheers = 0;
      this.boos = 0;
      this.likes = 0;
      this.dislikes = 0;
      this.cheerAmount = 0;
      this.booAmount = 0;
      this.lastUpdated = now;
    }
  }
}
