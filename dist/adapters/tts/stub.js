"use strict";
/**
 * Stub TTS adapter for testing or when no provider is configured.
 * Returns empty audio buffer (silence).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StubTTS = void 0;
class StubTTS {
    async synthesize(_text, _options) {
        return Buffer.alloc(0);
    }
}
exports.StubTTS = StubTTS;
//# sourceMappingURL=stub.js.map