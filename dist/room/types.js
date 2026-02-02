"use strict";
/**
 * Podium Outpost types (REST + WebSocket).
 * Aligned with podium interface considerations.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WS_INCOMING_NAMES = exports.WS_MESSAGE_TYPES = void 0;
exports.WS_MESSAGE_TYPES = {
    JOIN: "JOIN",
    LEAVE: "LEAVE",
    START_SPEAKING: "START_SPEAKING",
    STOP_SPEAKING: "STOP_SPEAKING",
    LIKE: "LIKE",
    DISLIKE: "DISLIKE",
    BOO: "BOO",
    CHEER: "CHEER",
    START_RECORDING: "START_RECORDING",
    STOP_RECORDING: "STOP_RECORDING",
};
exports.WS_INCOMING_NAMES = {
    USER_JOINED: "user.joined",
    USER_LEFT: "user.left",
    USER_STARTED_SPEAKING: "user.started_speaking",
    USER_STOPPED_SPEAKING: "user.stopped_speaking",
    REMAINING_TIME_UPDATED: "remaining_time.updated",
    USER_TIME_IS_UP: "user.time_is_up",
    CREATOR_JOINED: "creator.joined",
    USER_STARTED_RECORDING: "user.started_recording",
    USER_STOPPED_RECORDING: "user.stopped_recording",
    REACTIONS: "reactions",
    NOTIFICATIONS: "notifications",
};
//# sourceMappingURL=types.js.map