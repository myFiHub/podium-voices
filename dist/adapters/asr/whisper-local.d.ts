/**
 * Server-local Whisper ASR adapter.
 *
 * MVP implementation uses a long-lived Python worker running faster-whisper.
 * - Node writes input audio to a temp WAV file.
 * - The worker keeps the model loaded and returns transcript via JSONL over stdio.
 *
 * This adapter is intentionally conservative:
 * - `transcribe()` is implemented and required by IASR.
 * - `createStreamingSession()` is optional and implemented as a buffer-then-transcribe session.
 *   It provides the correct lifecycle integration for the orchestrator without depending on
 *   true incremental Whisper streaming semantics.
 */
import type { IASR, StreamingSession, StreamingSessionOptions, TranscriptResult } from "./types";
export interface WhisperLocalConfig {
    /** Whisper model name or path (e.g. base, small). */
    model: string;
    /** Whisper engine selector. MVP supports faster-whisper worker only. */
    engine?: string;
    /** Optional python interpreter path (defaults to python3). */
    pythonPath?: string;
}
export declare class WhisperLocalASR implements IASR {
    private readonly config;
    private worker;
    private rl;
    private nextId;
    private readonly pending;
    constructor(config: WhisperLocalConfig);
    /**
     * Transcribe audio to text.
     *
     * Supported formats:
     * - "wav" (default)
     * - "pcm16" (assumed 16kHz mono 16-bit little-endian)
     */
    transcribe(audioBuffer: Buffer, format?: string): Promise<TranscriptResult>;
    /**
     * Optional streaming session.
     *
     * MVP behavior: buffer PCM chunks and run a single transcription at `end()`.
     * This enables the orchestrator to use the streaming lifecycle without requiring
     * true incremental Whisper streaming support.
     */
    createStreamingSession(options: StreamingSessionOptions): StreamingSession;
    private normalizeToWav;
    private transcribeFile;
    private ensureWorker;
    private startWorker;
    private stopWorker;
}
//# sourceMappingURL=whisper-local.d.ts.map