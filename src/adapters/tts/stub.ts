/**
 * Stub TTS adapter for testing or when no provider is configured.
 * Returns empty audio buffer (silence).
 */

import type { ITTS, VoiceOptions } from "./types";

export class StubTTS implements ITTS {
  async synthesize(_text: string, _options?: VoiceOptions): Promise<Buffer> {
    return Buffer.alloc(0);
  }
}
