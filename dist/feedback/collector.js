"use strict";
/**
 * Feedback collector: map Podium WebSocket reaction events and/or live data to sentiment.
 * Subscribe to WS "reactions" and optionally poll getLatestLiveData; expose getSentiment() for the orchestrator.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackCollector = void 0;
const types_1 = require("../room/types");
const WINDOW_MS = 60_000;
class FeedbackCollector {
    cheers = 0;
    boos = 0;
    likes = 0;
    dislikes = 0;
    lastUpdated = 0;
    windowMs;
    constructor(config = {}) {
        this.windowMs = config.windowMs ?? WINDOW_MS;
    }
    /**
     * Handle incoming WebSocket message (e.g. reactions).
     * Podium sends { name: "reactions", data: { ... } }. Adjust counts based on message_type or data shape.
     */
    handleWSMessage(msg) {
        if (msg.name !== types_1.WS_INCOMING_NAMES.REACTIONS)
            return;
        const data = msg.data;
        if (!data)
            return;
        const now = Date.now();
        this.prune(now);
        if (data.type === "CHEER" || data.reaction === "cheer")
            this.cheers++;
        if (data.type === "BOO" || data.reaction === "boo")
            this.boos++;
        if (data.type === "LIKE" || data.reaction === "like")
            this.likes++;
        if (data.type === "DISLIKE" || data.reaction === "dislike")
            this.dislikes++;
        this.lastUpdated = now;
    }
    /**
     * Update from LiveMember[] (e.g. from getLatestLiveData). Aggregate feedbacks/reactions if present.
     */
    updateFromLiveMembers(members) {
        const now = Date.now();
        this.prune(now);
        for (const m of members) {
            const reactions = m.reactions;
            if (reactions) {
                if (reactions.cheer)
                    this.cheers += Number(reactions.cheer);
                if (reactions.boo)
                    this.boos += Number(reactions.boo);
                if (reactions.like)
                    this.likes += Number(reactions.like);
                if (reactions.dislike)
                    this.dislikes += Number(reactions.dislike);
            }
        }
        this.lastUpdated = now;
    }
    /** Get current sentiment for the orchestrator (cheer | boo | neutral). */
    getSentiment() {
        this.prune(Date.now());
        if (this.cheers > this.boos && (this.cheers > 0 || this.likes > this.dislikes))
            return "cheer";
        if (this.boos > this.cheers || this.dislikes > this.likes)
            return "boo";
        return "neutral";
    }
    getState() {
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
    prune(now) {
        if (now - this.lastUpdated > this.windowMs) {
            this.cheers = 0;
            this.boos = 0;
            this.likes = 0;
            this.dislikes = 0;
            this.lastUpdated = now;
        }
    }
}
exports.FeedbackCollector = FeedbackCollector;
//# sourceMappingURL=collector.js.map