/**
 * Jitsi room implementation backed by a Playwright-controlled browser loading
 * a minimal bot join page. Node↔browser audio over WebSocket (48kHz 20ms frames);
 * Node resamples 48k→16k for onIncomingAudio.
 */
import type { JitsiConfig, IJitsiRoom } from "./jitsi";
export declare class JitsiBrowserBot implements IJitsiRoom {
    private readonly config;
    private onIncomingAudioCb;
    private server;
    private wss;
    private ws;
    private browser;
    private page;
    private bridgePort;
    private txBuffer;
    private txQueue;
    private txInterval;
    private closed;
    private rxBytesTotal;
    private txBytesTotal;
    private lastRxTxAt;
    private statsInterval;
    private lastBotStatsWarnAt;
    private lastStats;
    private loggedTxFrameSample;
    private txSeq;
    private readonly debugFrames;
    private readonly saveWav;
    private wavBuffers;
    private wavBytes;
    private wroteWav;
    constructor(config: JitsiConfig);
    onIncomingAudio(callback: (buffer: Buffer, sampleRate: number) => void): void;
    private flushTxFrames;
    pushAudio(buffer: Buffer): void;
    /** True if browser and bridge are alive (for watchdog). */
    isAlive(): boolean;
    /** Rx/tx byte totals (for watchdog). */
    getRxTx(): {
        rx: number;
        tx: number;
    };
    leave(): Promise<void>;
    /** Start bridge server (HTTP + WebSocket), launch browser, load bot page; on WS connect send join. */
    start(): Promise<void>;
}
//# sourceMappingURL=jitsi-browser-bot.d.ts.map