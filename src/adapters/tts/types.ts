/**
 * TTS (Text-to-Speech) adapter types.
 * Implementations can be swapped via config (e.g. Google Cloud, Azure, local).
 */

export interface VoiceOptions {
  /** Voice name or id (provider-specific). */
  voiceName?: string;
  /** Language code (e.g. en-US). */
  languageCode?: string;
  /** Sample rate in Hz (e.g. 48000 for WebRTC). */
  sampleRateHz?: number;
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
