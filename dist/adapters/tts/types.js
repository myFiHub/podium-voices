"use strict";
/**
 * TTS (Text-to-Speech) adapter types.
 * Implementations can be swapped via config (e.g. Google Cloud, Azure, local).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttsToStream = ttsToStream;
/**
 * Normalize TTS result to async iterable of buffers for uniform consumption.
 */
async function* ttsToStream(result) {
    const resolved = await Promise.resolve(result);
    if (Symbol.asyncIterator in Object(resolved)) {
        yield* resolved;
    }
    else {
        yield resolved;
    }
}
//# sourceMappingURL=types.js.map