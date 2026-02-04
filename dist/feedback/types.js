"use strict";
/**
 * Audience feedback types for the AI co-host.
 * Maps Podium reactions (LIKE, DISLIKE, BOO, CHEER) to sentiment for prompt injection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FEEDBACK_THRESHOLDS = void 0;
exports.DEFAULT_FEEDBACK_THRESHOLDS = {
    // Defaults assume ~60s window; tune per persona.
    highPositive: { minCheers: 5, minLikes: 8 },
    positive: { minCheers: 2, minLikes: 4 },
    negative: { minBoos: 2, minDislikes: 4 },
    highNegative: { minBoos: 4, minDislikes: 8 },
};
//# sourceMappingURL=types.js.map