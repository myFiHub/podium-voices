/**
 * Audience feedback types for the AI co-host.
 * Maps Podium reactions (LIKE, DISLIKE, BOO, CHEER) to sentiment for prompt injection.
 */

export type FeedbackSentiment = "cheer" | "boo" | "neutral";

/**
 * Behavior level derived from the reaction register (counts/amounts) using thresholds.
 * This is intentionally coarse so it can drive prompt/tone changes deterministically.
 */
export type FeedbackBehaviorLevel = "high_positive" | "positive" | "neutral" | "negative" | "high_negative";

export interface FeedbackThresholds {
  /** Thresholds for strongly positive audience feedback. */
  highPositive: { minCheers?: number; minLikes?: number };
  /** Thresholds for mildly positive audience feedback. */
  positive: { minCheers?: number; minLikes?: number };
  /** Thresholds for mildly negative audience feedback. */
  negative: { minBoos?: number; minDislikes?: number };
  /** Thresholds for strongly negative audience feedback. */
  highNegative: { minBoos?: number; minDislikes?: number };
}

export const DEFAULT_FEEDBACK_THRESHOLDS: FeedbackThresholds = {
  // Defaults assume ~60s window; tune per persona.
  highPositive: { minCheers: 5, minLikes: 8 },
  positive: { minCheers: 2, minLikes: 4 },
  negative: { minBoos: 2, minDislikes: 4 },
  highNegative: { minBoos: 4, minDislikes: 8 },
};

export interface FeedbackState {
  sentiment: FeedbackSentiment;
  behaviorLevel: FeedbackBehaviorLevel;
  /** Counts in the last window (e.g. last minute). */
  cheers: number;
  boos: number;
  likes: number;
  dislikes: number;
  /**
   * Optional: summed reaction amounts (if the WS event includes `data.amount`).
   * Some Podium deployments may include a numeric amount for cheer/boo.
   */
  cheerAmount: number;
  booAmount: number;
  lastUpdated: number;
}
