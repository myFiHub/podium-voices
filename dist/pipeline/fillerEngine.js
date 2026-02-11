"use strict";
/**
 * Filler engine: chooses a short filler or backchannel to play before the main reply.
 * Reduces perceived latency (TTFA) by playing cached clips or quick TTS while the LLM generates.
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
exports.chooseFiller = chooseFiller;
exports.streamFillerClip = streamFillerClip;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Picks a filler for the given persona and optional context.
 * Returns null if no fillers are configured or no suitable clip is found.
 */
function chooseFiller(config, personaId, options) {
    const dirName = config.personaDirs?.[personaId] ?? personaId;
    const personaDir = path.join(config.basePath, dirName);
    const manifestPath = path.join(personaDir, "manifest.json");
    if (!fs.existsSync(manifestPath))
        return null;
    let manifest;
    try {
        const raw = fs.readFileSync(manifestPath, "utf8");
        manifest = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!Array.isArray(manifest.clips) || manifest.clips.length === 0)
        return null;
    // Simple strategy: pick first clip (or first matching sentiment/useCase if we add filters later).
    const entry = manifest.clips[0];
    const clipPath = path.join(personaDir, entry.path);
    if (!fs.existsSync(clipPath))
        return null;
    return {
        type: "clip",
        path: clipPath,
        lengthMs: entry.lengthMs,
        energy: entry.energy,
    };
}
/** Standard WAV header size (skip to get to PCM data). */
const WAV_HEADER_SIZE = 44;
/**
 * Stream filler audio from a clip file (WAV or raw PCM) in chunks.
 * If file looks like WAV (starts with "RIFF"), skips 44-byte header.
 * Yields buffers until the file is read or shouldAbort() returns true.
 */
async function* streamFillerClip(clipPath, chunkSizeBytes = 4096, shouldAbort = () => false) {
    const fd = fs.openSync(clipPath, "r");
    let offset = 0;
    try {
        const first = Buffer.alloc(4);
        if (fs.readSync(fd, first, 0, 4, 0) >= 4 && first.toString("ascii", 0, 4) === "RIFF") {
            offset = WAV_HEADER_SIZE;
        }
    }
    catch {
        // ignore; offset stays 0
    }
    try {
        let position = offset;
        const buf = Buffer.alloc(chunkSizeBytes);
        let n;
        while (!shouldAbort() && (n = fs.readSync(fd, buf, 0, chunkSizeBytes, position)) > 0) {
            position += n;
            yield n < chunkSizeBytes ? buf.subarray(0, n) : Buffer.from(buf);
        }
    }
    finally {
        fs.closeSync(fd);
    }
}
//# sourceMappingURL=fillerEngine.js.map