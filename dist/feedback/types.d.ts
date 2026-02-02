/**
 * Audience feedback types for the AI co-host.
 * Maps Podium reactions (LIKE, DISLIKE, BOO, CHEER) to sentiment for prompt injection.
 */
export type FeedbackSentiment = "cheer" | "boo" | "neutral";
export interface FeedbackState {
    sentiment: FeedbackSentiment;
    /** Counts in the last window (e.g. last minute). */
    cheers: number;
    boos: number;
    likes: number;
    dislikes: number;
    lastUpdated: number;
}
//# sourceMappingURL=types.d.ts.map