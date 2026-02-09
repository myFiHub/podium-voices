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
    private readonly recvGateConsecutiveN;
    /**
     * Test mode: inject a deterministic PCM stimulus into the outbound audio path.
     *
     * Used by E2E gates to verify publish audio without relying on TTS/provider variability.
     *
     * Env:
     * - PCM_STIMULUS_ENABLE=1
     * - PCM_STIMULUS_AGENT_ID=alex   (optional; when set, only inject for matching AGENT_ID)
     * - PCM_STIMULUS_WAV=/abs/or/rel.wav (optional; PCM16 WAV; mono preferred)
     * - PCM_STIMULUS_PCM=/abs/or/rel.pcm (optional; raw s16le mono)
     * - PCM_STIMULUS_PCM_RATE_HZ=48000   (only for raw PCM; default 48000)
     * - PCM_STIMULUS_MAX_MS=1500         (cap duration; default 1500ms)
     * - PCM_STIMULUS_TONE_HZ=440         (tone fallback; default 440Hz)
     * - PCM_STIMULUS_GAIN=0.18           (tone fallback; 0..1; default 0.18)
     */
    private readonly pcmStimulusEnabled;
    private readonly pcmStimulusAgentId;
    private readonly pcmStimulusWavPath;
    private readonly pcmStimulusPcmPath;
    private readonly pcmStimulusPcmRateHz;
    private readonly pcmStimulusMaxMs;
    private readonly pcmStimulusToneHz;
    private readonly pcmStimulusGain;
    private pcmStimulusInjected;
    private pcmStimulusScheduledAt;
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
    private receiveContractPassStreak;
    private recvGatePassedAt;
    private lastLoggedReceiveContractPass;
    private lastLoggedPublishContractPass;
    private diagStatsStream;
    private diagStatsPath;
    private diagStartedAt;
    private diagTimer;
    private diagMaxInboundBytesDelta;
    private diagMaxPreMixerMaxAbs;
    private diagMaxPostMixerMaxAbs;
    private diagMaxOutboundBytesDelta;
    /**
     * BOT_DIAG-only: peak maxAbs observed at Node on *received* room audio frames.
     *
     * We keep this separate from `lastNodeRoomAudioMaxAbs` (which is computed over a 5s rolling window
     * and only updates once the ring buffer fills). During short diagnostics it’s possible for the
     * rolling window to remain 0 even if a brief non-silent frame arrived.
     */
    private diagMaxNodeRoomMaxAbs;
    constructor(config: JitsiConfig);
    private shouldInjectPcmStimulus;
    private decodeWavPcm16;
    private downmixToMonoS16leInterleaved;
    private generateSinePcm;
    private loadStimulusPcm48k;
    private maybeStartPcmStimulus;
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