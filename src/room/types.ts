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

export const WS_MESSAGE_TYPES = {
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
} as const;

export const WS_INCOMING_NAMES = {
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
} as const;
