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
    private jitsiJoinedAt;
    private lastStats;
    private loggedTxFrameSample;
    private txSeq;
    private readonly debugFrames;
    private readonly saveWav;
    private readonly botDiag;
    private readonly botDiagDurationMs;
    private readonly artifactRetentionN;
    private readonly preMixerPassThreshold;
    private readonly sessionId;
    private readonly conferenceId;
    private wavBuffers;
    private wavBytes;
    private wroteWav;
    /** Ring buffer for room-audio level diagnostic: last 5s of 16k resampled PCM. */
    private static readonly RX_LEVEL_RING_FRAMES;
    private static readonly RX_LEVEL_FRAME_BYTES;
    private rxLevelRing;
    private rxLevelFrameCount;
    private lastRoomAudioSilentWarnAt;
    private lastMixerLevelLogAt;
    private lastNodeRoomAudioMaxAbs;
    private lastTtsFrameSentAt;
    private remoteTrackSeen;
    private consecutiveNoInboundProbes;
    private consecutiveNoOutboundProbes;
    private diagStatsStream;
    private diagStatsPath;
    private diagStartedAt;
    private diagTimer;
    private diagMaxInboundBytesDelta;
    private diagMaxPreMixerMaxAbs;
    private diagMaxPostMixerMaxAbs;
    private diagMaxOutboundBytesDelta;
    constructor(config: JitsiConfig);
    onIncomingAudio(callback: (buffer: Buffer, sampleRate: number) => void): void;
    /**
     * Accumulate resampled room audio and periodically log RMS/maxAbs so we can see if
     * Node is receiving non-silent audio (if levels are ~0, VAD will never fire).
     */
    private updateRoomAudioLevel;
    private startBotDiagIfEnabled;
    private finishBotDiag;
    private handleTruthProbe;
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