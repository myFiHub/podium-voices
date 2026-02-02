"use strict";
/**
 * Stub ASR adapter for testing or when no provider is configured.
 * Returns empty transcript.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StubASR = void 0;
class StubASR {
    async transcribe(_audioBuffer, _format) {
        return { text: "" };
    }
}
exports.StubASR = StubASR;
//# sourceMappingURL=stub.js.map