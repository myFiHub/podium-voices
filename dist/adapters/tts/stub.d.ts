/**
 * Stub TTS adapter for testing or when no provider is configured.
 * Returns empty audio buffer (silence).
 */
import type { ITTS, VoiceOptions } from "./types";
export declare class StubTTS implements ITTS {
    synthesize(_text: string, _options?: VoiceOptions): Promise<Buffer>;
}
//# sourceMappingURL=stub.d.ts.map