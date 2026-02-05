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
  words?: Array<{ word: string; start: number; end: number }>;
}

/**
 * Partial transcript updates for streaming-capable ASR providers.
 *
 * NOTE: Providers like Whisper/faster-whisper may emit "hypotheses" that can revise
 * prior text; consumers MUST NOT assume partials are strictly append-only.
 */
export interface StreamingTranscriptPart {
  /** Partial (or final) transcript text. */
  text: string;
  /** True if this part is a final transcript segment. */
  isFinal: boolean;
  /** Optional language code. */
  language?: string;
}

export interface StreamingSessionOptions {
  /**
   * Sample rate of PCM pushed into the session.
   * If the adapter cannot handle this value, it should throw early with a clear error.
   */
  sampleRateHz?: number;
  /**
   * Callback for partial transcript updates.
   * Consumers should treat these as informational; final transcript is returned by `end()`.
   */
  onPartial?: (part: StreamingTranscriptPart) => void;
}

/**
 * Streaming ASR session created by adapters that support it.
 *
 * Contract:
 * - `push(chunk)` expects raw PCM bytes (e.g. 16kHz, mono, 16-bit little-endian) unless
 *   otherwise documented by the adapter.
 * - Call `end()` when the utterance is complete to obtain a final `TranscriptResult`.
 */
export interface StreamingSession {
  push(chunk: Buffer): void;
  end(): Promise<TranscriptResult>;
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

  /**
   * Optional: create a streaming ASR session for lower-latency transcription.
   * Adapters that do not support streaming should omit this method.
   */
  createStreamingSession?(options: StreamingSessionOptions): StreamingSession;
}
