/**
 * Feedback collector: map Podium WebSocket reaction events and/or live data to sentiment.
 * Subscribe to WS "reactions" and optionally poll getLatestLiveData; expose getSentiment() for the orchestrator.
 */
import type { FeedbackBehaviorLevel, FeedbackSentiment, FeedbackState, FeedbackThresholds } from "./types";
import type { WSInMessage } from "../room/types";
export interface FeedbackCollectorConfig {
    /** How long to keep reaction counts (ms). */
    windowMs?: number;
    /**
     * Optional: only count reactions that target this wallet address.
     * When unset, count all reactions (room mood).
     */
    reactToUserAddressFilter?: string;
}
export declare class FeedbackCollector {
    private cheers;
    private boos;
    private likes;
    private dislikes;
    private cheerAmount;
    private booAmount;
    private lastUpdated;
    private readonly windowMs;
    private reactToUserAddressFilter?;
    constructor(config?: FeedbackCollectorConfig);
    /**
     * Optional: only count reactions that target this wallet address.
     * When unset, count all reactions (room mood).
     */
    setReactToUserAddressFilter(address?: string): void;
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
    /**
     * Derive a behavior level from the reaction register using thresholds.
     * Negative levels are checked first so the agent is biased toward de-escalation.
     */
    getBehaviorLevel(thresholds?: FeedbackThresholds): FeedbackBehaviorLevel;
    getState(): FeedbackState;
    private prune;
}
//# sourceMappingURL=collector.d.ts.map