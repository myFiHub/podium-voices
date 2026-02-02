/**
 * High-level Podium room client: runs host join flow and exposes audio in/out.
 * Uses REST (api), WebSocket (ws), and Jitsi (jitsi) to join as host; then provides
 * incoming audio stream for the pipeline and a method to push TTS output.
 */
import type { User, OutpostModel } from "./types";
export interface RoomClientConfig {
    apiUrl: string;
    wsAddress: string;
    outpostServer: string;
    token: string;
    outpostUuid: string;
    /** Use browser bot for Jitsi (real audio). When false, JitsiStub is used. */
    useJitsiBot?: boolean;
    /** URL of the minimal bot join page. If unset and useJitsiBot, Node serves bot-page/. */
    botPageUrl?: string;
    /** XMPP domain for Jitsi (e.g. meet.jitsi). When public meet URL differs from Prosody host, set this. */
    jitsiXmppDomain?: string;
    /** XMPP MUC domain for conference rooms (e.g. muc.meet.jitsi). Jitsi Docker uses muc.<domain>; set when not using default conference.<xmppDomain>. */
    jitsiMucDomain?: string;
    /** JWT for Jitsi/Prosody meeting join. Only when deployment requires JWT auth to join the conference. */
    jitsiJwt?: string;
    /** First port to try for the Jitsi bot bridge (default 8766). If in use, next ports are tried. */
    jitsiBridgePort?: number;
}
export interface RoomClientCallbacks {
    /** Incoming audio for pipeline (16kHz mono 16-bit PCM for VAD). */
    onAudioChunk?(buffer: Buffer): void;
}
export declare class RoomClient {
    private api;
    private ws;
    private jitsi;
    private user;
    private outpost;
    private readonly config;
    private callbacks;
    constructor(config: RoomClientConfig);
    onAudioChunk(cb: (buffer: Buffer) => void): void;
    /** Run full host join flow. Returns when joined (WS + optional Jitsi). */
    join(): Promise<{
        user: User;
        outpost: OutpostModel;
    }>;
    /** Push TTS audio to the room (PCM 16-bit mono). */
    pushTtsAudio(buffer: Buffer): void;
    /** Health checks for watchdog: WS connected, conference alive, audio rx/tx. */
    getHealthChecks(): {
        wsConnected: () => boolean;
        conferenceAlive: () => boolean;
        audioRxTx: () => {
            rx: number;
            tx: number;
        } | null;
    };
    /** Leave outpost and close connections. */
    leave(): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map