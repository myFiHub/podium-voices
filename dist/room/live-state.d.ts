import type { OutpostLiveData, WSInMessage } from "./types";
export interface LiveStateConfig {
    /** The bot's Podium user identity. */
    selfAddress: string;
    selfUuid: string;
    /** Outpost creator UUID (creator has unlimited time). */
    creatorUuid: string;
}
export interface SpeakAllowance {
    allowed: boolean;
    reason?: string;
}
/**
 * LiveState tracks per-member speaking time + speaking state based on:
 * - initial snapshot from GET /outposts/online-data
 * - incremental WS updates (remaining_time.updated, user.time_is_up, started/stopped_speaking)
 *
 * Source of truth is the server; this module does not run a local countdown.
 */
export declare class LiveState {
    private readonly cfg;
    private membersByAddress;
    constructor(cfg: LiveStateConfig);
    applySnapshot(live: OutpostLiveData): void;
    handleWSMessage(msg: WSInMessage): void;
    /** Returns true if this bot is the creator (unlimited speaking time). */
    isCreator(): boolean;
    /** Get the bot's remaining time (seconds), or \"unlimited\" for creator, or \"unknown\" if not present. */
    getSelfRemainingTime(): number | "unlimited" | "unknown";
    /** Nexus parity rule: if not creator and remaining_time <= 0, do not start speaking. */
    canSpeakNow(): SpeakAllowance;
    isSelfTimeUpEvent(msg: WSInMessage): boolean;
    private upsertAddress;
}
//# sourceMappingURL=live-state.d.ts.map