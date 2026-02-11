/**
 * TTS (Text-to-Speech) adapter types.
 * Implementations can be swapped via config (e.g. Google Cloud, Azure, local).
 */

export interface VoiceOptions {
  /** Voice name or id (provider-specific). Used for persona voice profiles. */
  voiceName?: string;
  /** Language code (e.g. en-US). */
  languageCode?: string;
  /** Sample rate in Hz (e.g. 48000 for WebRTC). */
  sampleRateHz?: number;
  /** Optional speaking rate (provider-specific). */
  speakingRate?: number;
}

/**
 * TTS adapter interface: text in, audio buffer(s) out.
 * Prefer streaming (AsyncIterable<Buffer>) when provider supports it for lower latency.
 */
export interface ITTS {
  /**
   * Synthesize text to speech.
   * Returns either a single buffer or an async iterable of chunks for streaming.
   */
  synthesize(
    text: string,
    options?: VoiceOptions
  ): Promise<Buffer> | Promise<AsyncIterable<Buffer>> | AsyncIterable<Buffer>;

  /**
   * Optional: stream text to speech as text becomes available (e.g. from LLM).
   * Yields audio chunks as soon as possible for lower TTFA.
   * Adapters that do not support this omit it; orchestrator falls back to synthesize().
   */
  synthesizeStream?(
    input: AsyncIterable<string> | Iterable<string>,
    options?: VoiceOptions
  ): AsyncIterable<Buffer>;
}

/**
 * Normalize TTS result to async iterable of buffers for uniform consumption.
 */
export async function* ttsToStream(
  result: Promise<Buffer> | Promise<AsyncIterable<Buffer>> | AsyncIterable<Buffer>
): AsyncIterable<Buffer> {
  const resolved = await Promise.resolve(result);
  if (Symbol.asyncIterator in Object(resolved)) {
    yield* resolved as AsyncIterable<Buffer>;
  } else {
    yield resolved as Buffer;
  }
}
