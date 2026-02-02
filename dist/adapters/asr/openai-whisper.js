"use strict";
/**
 * OpenAI Whisper API ASR adapter.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIWhisperASR = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const openai_1 = __importDefault(require("openai"));
class OpenAIWhisperASR {
    config;
    client;
    constructor(config) {
        this.config = config;
        this.client = new openai_1.default({ apiKey: config.apiKey });
    }
    async transcribe(audioBuffer, format = "wav") {
        const ext = format === "webm" ? "webm" : "wav";
        const tmpPath = path.join(os.tmpdir(), `whisper-${Date.now()}.${ext}`);
        try {
            fs.writeFileSync(tmpPath, audioBuffer);
            const transcription = await this.client.audio.transcriptions.create({
                file: fs.createReadStream(tmpPath),
                model: "whisper-1",
                response_format: "verbose_json",
            });
            const result = transcription;
            return {
                text: result.text ?? "",
                language: result.language,
                words: result.words,
            };
        }
        finally {
            try {
                fs.unlinkSync(tmpPath);
            }
            catch {
                // ignore
            }
        }
    }
}
exports.OpenAIWhisperASR = OpenAIWhisperASR;
//# sourceMappingURL=openai-whisper.js.map