/**
 * Podium WebSocket client.
 * Connect with ?token=<token>&timezone=<IANA>.
 * Outgoing messages must use exact keys: message_type (lowercase, e.g. "join"), outpost_uuid (snake_case).
 */
import type { WSOutMessage, WSInMessage } from "./types";
export interface PodiumWSConfig {
    wsAddress: string;
    token: string;
    timezone?: string;
}
export type WSMessageHandler = (msg: WSInMessage) => void;
export declare class PodiumWS {
    private ws;
    private readonly config;
    private handlers;
    constructor(config: PodiumWSConfig);
    onMessage(handler: WSMessageHandler): void;
    connect(): Promise<void>;
    send(msg: WSOutMessage | Record<string, unknown>): void;
    /** Send JOIN and wait for user.joined for this user (match by address or uuid). */
    joinOutpost(outpostUuid: string, myAddress: string, options?: {
        myUuid?: string;
        timeoutMs?: number;
    }): Promise<void>;
    leave(outpostUuid: string): void;
    startSpeaking(outpostUuid: string): void;
    stopSpeaking(outpostUuid: string): void;
    /** Reactions: data must include react_to_user_address (wallet address of target user). */
    sendReaction(outpostUuid: string, reactionType: "like" | "dislike" | "boo" | "cheer", reactToUserAddress: string): void;
    /** True if WebSocket is open (for watchdog). */
    isConnected(): boolean;
    close(): void;
}
//# sourceMappingURL=ws.d.ts.map