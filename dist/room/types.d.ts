/**
 * Podium Outpost types (REST + WebSocket).
 * Aligned with podium interface considerations.md.
 */
export interface User {
    uuid: string;
    address: string;
    name: string;
    image?: string;
}
export interface OutpostModel {
    uuid: string;
    creator_user_uuid: string;
    creator_user_name?: string;
    creator_user_image?: string;
    cohost_user_uuids?: string[];
    outpost_host_url?: string;
    scheduled_for: number;
    is_archived?: boolean;
    has_adult_content?: boolean;
    enter_type?: string;
    speak_type?: string;
    name?: string;
    subject?: string;
    tags?: string[];
}
export interface LiveMember {
    address: string;
    uuid: string;
    name: string;
    image?: string;
    can_speak?: boolean;
    is_present?: boolean;
    is_speaking?: boolean;
    remaining_time?: number;
    feedbacks?: unknown;
    reactions?: unknown;
    is_recording?: boolean;
}
export interface OutpostLiveData {
    members: LiveMember[];
}
/** Outgoing WebSocket message. */
export interface WSOutMessage {
    message_type: string;
    outpost_uuid: string;
    data?: Record<string, unknown>;
}
/** Incoming WebSocket message. */
export interface WSInMessage {
    name: string;
    data?: Record<string, unknown>;
}
export declare const WS_MESSAGE_TYPES: {
    readonly JOIN: "JOIN";
    readonly LEAVE: "LEAVE";
    readonly START_SPEAKING: "START_SPEAKING";
    readonly STOP_SPEAKING: "STOP_SPEAKING";
    readonly LIKE: "LIKE";
    readonly DISLIKE: "DISLIKE";
    readonly BOO: "BOO";
    readonly CHEER: "CHEER";
    readonly START_RECORDING: "START_RECORDING";
    readonly STOP_RECORDING: "STOP_RECORDING";
};
export declare const WS_INCOMING_NAMES: {
    readonly USER_JOINED: "user.joined";
    readonly USER_LEFT: "user.left";
    readonly USER_STARTED_SPEAKING: "user.started_speaking";
    readonly USER_STOPPED_SPEAKING: "user.stopped_speaking";
    /** Podium reactions (one message per reaction; nexus-compatible). */
    readonly USER_LIKED: "user.liked";
    readonly USER_DISLIKED: "user.disliked";
    readonly USER_BOOED: "user.booed";
    readonly USER_CHEERED: "user.cheered";
    readonly REMAINING_TIME_UPDATED: "remaining_time.updated";
    readonly USER_TIME_IS_UP: "user.time_is_up";
    readonly CREATOR_JOINED: "creator.joined";
    readonly USER_STARTED_RECORDING: "user.started_recording";
    readonly USER_STOPPED_RECORDING: "user.stopped_recording";
    readonly REACTIONS: "reactions";
    readonly NOTIFICATIONS: "notifications";
};
//# sourceMappingURL=types.d.ts.map