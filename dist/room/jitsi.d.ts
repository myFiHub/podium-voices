/**
 * Jitsi meeting client interface.
 * In Node we do not have a built-in Jitsi SDK; actual audio capture/publish requires
 * a browser (Jitsi Meet API) or a headless WebRTC stack. This module defines the
 * interface and a no-op stub for testing. Replace with real implementation when
 * integrating (e.g. Puppeteer + Jitsi Meet or a Node WebRTC library).
 */
import type { User } from "./types";
export interface JitsiConfig {
    /** Hostname only (no https://). Used for lib URL and BOSH serviceUrl (public URL). */
    domain: string;
    /** Prosody VirtualHost / XMPP domain (e.g. meet.jitsi). When set, bot uses this for JIDs instead of domain. Required when public URL differs from XMPP domain. */
    xmppDomain?: string;
    /** XMPP MUC domain for conference rooms (room JID = roomName@muc). If unset, bot uses conference.<xmppDomain>. */
    mucDomain?: string;
    roomName: string;
    user: User;
    /** In nexus, creatorUuid is sometimes passed as a double-quoted string; use same format if Jitsi API expects it. */
    creatorUuid: string;
    cohostUuids: string[];
    /** Use browser bot for real Jitsi. When false, JitsiStub is used. */
    useJitsiBot?: boolean;
    /** URL of the minimal bot join page. If unset, Node serves bot-page/ on the bridge port. */
    botPageUrl?: string;
    /** JWT for Jitsi/Prosody meeting join. Only when deployment requires JWT auth to join the conference. */
    jwt?: string;
    /** First port to try for the bridge (default 8766). If in use, next ports are tried. */
    bridgePort?: number;
}
export interface IJitsiRoom {
    /** Subscribe to incoming audio (mixed or per-participant). Callback receives PCM 16-bit mono at given sample rate. */
    onIncomingAudio(callback: (buffer: Buffer, sampleRate: number) => void): void;
    /** Push TTS output to the room (PCM 16-bit mono, typically 48kHz). */
    pushAudio(buffer: Buffer): void;
    /** Leave and close. */
    leave(): Promise<void>;
    /** Optional: start bridge/browser (e.g. JitsiBrowserBot). No-op if not implemented. */
    start?(): Promise<void>;
    /** Optional: true if conference/browser is alive (for watchdog). */
    isAlive?(): boolean;
    /** Optional: rx/tx byte totals (for watchdog). */
    getRxTx?(): {
        rx: number;
        tx: number;
    };
}
/**
 * Stub Jitsi client: no real connection. Used when testing with mock room only.
 * For real Podium integration, implement with Jitsi Meet API (browser) or Node WebRTC.
 */
export declare class JitsiStub implements IJitsiRoom {
    private audioCallback;
    constructor(_config: JitsiConfig);
    onIncomingAudio(callback: (buffer: Buffer, sampleRate: number) => void): void;
    pushAudio(buffer: Buffer): void;
    leave(): Promise<void>;
}
/**
 * Create Jitsi room client. Returns JitsiBrowserBot when useJitsiBot is true; otherwise JitsiStub.
 */
export declare function createJitsiRoom(config: JitsiConfig): IJitsiRoom;
/**
 * Transform user UUID to email-like string for Jitsi (e.g. uuid-no-dashes@gmail.com).
 */
export declare function transformIdToEmailLike(uuid: string): string;
//# sourceMappingURL=jitsi.d.ts.map