"use strict";
/**
 * Mock room for local testing: no Podium connection.
 * Optionally feed audio from a WAV file and capture TTS output to a buffer or file.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockRoom = void 0;
const fs = __importStar(require("fs"));
const vad_1 = require("../pipeline/vad");
const audio_utils_1 = require("../pipeline/audio-utils");
class MockRoom {
    ttsBuffers = [];
    callbacks = {};
    config;
    constructor(config = {}) {
        this.config = config;
    }
    onAudioChunk(cb) {
        this.callbacks.onAudioChunk = cb;
    }
    /**
     * Push TTS audio (e.g. from orchestrator callback). Accumulates; flush to file with flushTtsToFile().
     */
    pushTtsAudio(buffer) {
        this.ttsBuffers.push(buffer);
    }
    /** Get accumulated TTS audio as single buffer. */
    getTtsBuffer() {
        return Buffer.concat(this.ttsBuffers);
    }
    /** Write accumulated TTS to WAV file (48kHz mono 16-bit) and clear buffer. */
    flushTtsToFile(filePath) {
        const outPath = filePath ?? this.config.outputWavPath;
        if (!outPath)
            throw new Error("No output path");
        const pcm = Buffer.concat(this.ttsBuffers);
        this.ttsBuffers = [];
        const wav = (0, audio_utils_1.pcmToWav)(pcm, 48000);
        fs.writeFileSync(outPath, wav);
        return outPath;
    }
    /**
     * Simulate room audio by reading a WAV file and feeding chunks to onAudioChunk.
     * Expects 16kHz mono 16-bit WAV for VAD. Chunk size = VAD frame size.
     */
    feedFromWav(wavPath) {
        const p = wavPath ?? this.config.inputWavPath;
        if (!p || !fs.existsSync(p))
            return;
        const buf = fs.readFileSync(p);
        const dataOffset = 44;
        const pcm = buf.subarray(dataOffset);
        const frameSize = vad_1.VAD.getFrameSizeBytes();
        let offset = 0;
        while (offset + frameSize <= pcm.length) {
            this.callbacks.onAudioChunk?.(pcm.subarray(offset, offset + frameSize));
            offset += frameSize;
        }
    }
    /** Simulate joining (no-op). */
    async join() {
        return {
            user: { uuid: "mock-user", address: "0xmock", name: "Mock User" },
            outpost: { uuid: "mock-outpost" },
        };
    }
    async leave() { }
}
exports.MockRoom = MockRoom;
//# sourceMappingURL=mock.js.map