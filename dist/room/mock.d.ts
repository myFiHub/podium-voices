/**
 * Mock room for local testing: no Podium connection.
 * Optionally feed audio from a WAV file and capture TTS output to a buffer or file.
 */
export interface MockRoomConfig {
    /** Optional path to WAV file to use as simulated room audio (16kHz mono 16-bit). */
    inputWavPath?: string;
    /** Optional path to write TTS output WAV. */
    outputWavPath?: string;
}
export interface MockRoomCallbacks {
    onAudioChunk?(buffer: Buffer): void;
}
export declare class MockRoom {
    private ttsBuffers;
    private callbacks;
    private readonly config;
    constructor(config?: MockRoomConfig);
    onAudioChunk(cb: (buffer: Buffer) => void): void;
    /**
     * Push TTS audio (e.g. from orchestrator callback). Accumulates; flush to file with flushTtsToFile().
     */
    pushTtsAudio(buffer: Buffer): void;
    /** Get accumulated TTS audio as single buffer. */
    getTtsBuffer(): Buffer;
    /** Write accumulated TTS to WAV file (48kHz mono 16-bit) and clear buffer. */
    flushTtsToFile(filePath?: string): string;
    /**
     * Simulate room audio by reading a WAV file and feeding chunks to onAudioChunk.
     * Expects 16kHz mono 16-bit WAV for VAD. Chunk size = VAD frame size.
     */
    feedFromWav(wavPath?: string): void;
    /** Simulate joining (no-op). */
    join(): Promise<{
        user: {
            uuid: string;
            address: string;
            name: string;
        };
        outpost: {
            uuid: string;
        };
    }>;
    leave(): Promise<void>;
}
//# sourceMappingURL=mock.d.ts.map