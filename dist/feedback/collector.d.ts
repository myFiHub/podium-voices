/**
 * Feedback collector: map Podium WebSocket reaction events and/or live data to sentiment.
 * Subscribe to WS "reactions" and optionally poll getLatestLiveData; expose getSentiment() for the orchestrator.
 */
import type { FeedbackSentiment, FeedbackState } from "./types";
import type { WSInMessage } from "../room/types";
export interface FeedbackCollectorConfig {
    /** How long to keep reaction counts (ms). */
    windowMs?: number;
}
export declare class FeedbackCollector {
    private cheers;
    private boos;
    private likes;
    private dislikes;
    private lastUpdated;
    private readonly windowMs;
    constructor(config?: FeedbackCollectorConfig);
    /**
     * Handle incoming WebSocket message (e.g. reactions).
     * Podium sends { name: "reactions", data: { ... } }. Adjust counts based on message_type or data shape.
     */
    handleWSMessage(msg: WSInMessage): void;
    /**
     * Update from LiveMember[] (e.g. from getLatestLiveData). Aggregate feedbacks/reactions if present.
     */
    updateFromLiveMembers(members: Array<{
        feedbacks?: unknown;
        reactions?: unknown;
    }>): void;
    /** Get current sentiment for the orchestrator (cheer | boo | neutral). */
    getSentiment(): FeedbackSentiment;
    getState(): FeedbackState;
    private prune;
}
//# sourceMappingURL=collector.d.ts.map