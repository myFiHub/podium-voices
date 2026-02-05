"use strict";
/**
 * ASR adapter factory: returns implementation based on config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhisperLocalASR = exports.OpenAIWhisperASR = exports.StubASR = void 0;
exports.createASR = createASR;
const stub_1 = require("./stub");
const openai_whisper_1 = require("./openai-whisper");
const whisper_local_1 = require("./whisper-local");
var stub_2 = require("./stub");
Object.defineProperty(exports, "StubASR", { enumerable: true, get: function () { return stub_2.StubASR; } });
var openai_whisper_2 = require("./openai-whisper");
Object.defineProperty(exports, "OpenAIWhisperASR", { enumerable: true, get: function () { return openai_whisper_2.OpenAIWhisperASR; } });
var whisper_local_2 = require("./whisper-local");
Object.defineProperty(exports, "WhisperLocalASR", { enumerable: true, get: function () { return whisper_local_2.WhisperLocalASR; } });
function createASR(config) {
    const { provider, openaiApiKey, whisperModel, whisperEngine, whisperPythonPath } = config.asr;
    if (provider === "openai" && openaiApiKey) {
        return new openai_whisper_1.OpenAIWhisperASR({ apiKey: openaiApiKey });
    }
    if (provider === "whisper-local") {
        return new whisper_local_1.WhisperLocalASR({
            model: whisperModel || "base",
            engine: whisperEngine || "faster-whisper",
            pythonPath: whisperPythonPath,
        });
    }
    return new stub_1.StubASR();
}
//# sourceMappingURL=index.js.map