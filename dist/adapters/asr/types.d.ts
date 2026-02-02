/**
 * ASR (Automatic Speech Recognition) adapter types.
 * Implementations can be swapped via config (e.g. OpenAI Whisper, local Whisper, stub).
 */
export interface TranscriptResult {
    /** Transcribed text. */
    text: string;
    /** Optional language code. */
    language?: string;
    /** Optional word-level timestamps. */
    words?: Array<{
        word: string;
        start: number;
        end: number;
    }>;
}
/**
 * ASR adapter interface: audio buffer in, transcript out.
 * Optional: streaming interface later for lower latency.
 */
export interface IASR {
    /**
     * Transcribe audio to text.
     * @param audioBuffer - Raw audio bytes (e.g. PCM 16-bit mono, or format specified).
     * @param format - Optional format hint (e.g. "wav", "mp3", "webm"). Provider-dependent.
     */
    transcribe(audioBuffer: Buffer, format?: string): Promise<TranscriptResult>;
}
//# sourceMappingURL=types.d.ts.map