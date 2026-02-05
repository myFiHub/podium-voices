"use strict";
/**
 * Server-local Whisper ASR adapter.
 *
 * MVP implementation uses a long-lived Python worker running faster-whisper.
 * - Node writes input audio to a temp WAV file.
 * - The worker keeps the model loaded and returns transcript via JSONL over stdio.
 *
 * This adapter is intentionally conservative:
 * - `transcribe()` is implemented and required by IASR.
 * - `createStreamingSession()` is optional and implemented as a buffer-then-transcribe session.
 *   It provides the correct lifecycle integration for the orchestrator without depending on
 *   true incremental Whisper streaming semantics.
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
exports.WhisperLocalASR = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const readline = __importStar(require("readline"));
const audio_utils_1 = require("../../pipeline/audio-utils");
const logging_1 = require("../../logging");
class WhisperLocalASR {
    config;
    worker = null;
    rl = null;
    nextId = 1;
    pending = new Map();
    constructor(config) {
        this.config = config;
    }
    /**
     * Transcribe audio to text.
     *
     * Supported formats:
     * - "wav" (default)
     * - "pcm16" (assumed 16kHz mono 16-bit little-endian)
     */
    async transcribe(audioBuffer, format = "wav") {
        const wav = this.normalizeToWav(audioBuffer, format);
        const tmpPath = path.join(os.tmpdir(), `whisper-local-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
        try {
            await fs.promises.writeFile(tmpPath, wav);
            const result = await this.transcribeFile(tmpPath);
            return result;
        }
        finally {
            try {
                await fs.promises.unlink(tmpPath);
            }
            catch {
                // ignore temp cleanup failures
            }
        }
    }
    /**
     * Optional streaming session.
     *
     * MVP behavior: buffer PCM chunks and run a single transcription at `end()`.
     * This enables the orchestrator to use the streaming lifecycle without requiring
     * true incremental Whisper streaming support.
     */
    createStreamingSession(options) {
        const sampleRateHz = options.sampleRateHz ?? 16000;
        const chunks = [];
        return {
            push: (chunk) => {
                chunks.push(chunk);
            },
            end: async () => {
                const pcm = Buffer.concat(chunks);
                // We treat pushed chunks as raw PCM16 mono.
                const wav = (0, audio_utils_1.pcmToWav)(pcm, sampleRateHz);
                // For MVP, no partials are emitted (Whisper hypotheses are not stable).
                return await this.transcribe(wav, "wav");
            },
        };
    }
    normalizeToWav(audioBuffer, format) {
        const fmt = (format || "wav").toLowerCase();
        if (fmt === "wav")
            return audioBuffer;
        if (fmt === "pcm16" || fmt === "pcm") {
            // The pipeline contract is 16kHz mono PCM16.
            return (0, audio_utils_1.pcmToWav)(audioBuffer, 16000);
        }
        throw new Error(`WhisperLocalASR: unsupported format '${format}'. Supported: wav | pcm16`);
    }
    async transcribeFile(audioPath) {
        await this.ensureWorker();
        const id = this.nextId++;
        const req = { id, op: "transcribe", audioPath };
        const startedAt = Date.now();
        logging_1.logger.debug({ event: "WHISPER_LOCAL_REQUEST", id, audioPath }, "whisper-local: sending transcribe request to worker");
        const p = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        this.worker.stdin.write(JSON.stringify(req) + "\n");
        try {
            const result = await p;
            logging_1.logger.info({ event: "WHISPER_LOCAL_RESULT", id, textLength: result.text.length, durationMs: Date.now() - startedAt }, "whisper-local: transcription completed");
            return result;
        }
        catch (e) {
            logging_1.logger.error({ event: "WHISPER_LOCAL_ERROR", id, err: e.message }, "whisper-local: transcription failed");
            throw e;
        }
    }
    async ensureWorker() {
        if (this.worker && this.worker.exitCode == null)
            return;
        this.startWorker();
        // Wait briefly for READY so errors surface early in logs.
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    startWorker() {
        this.stopWorker();
        const engine = (this.config.engine || "faster-whisper").trim();
        const model = (this.config.model || "base").trim();
        const python = (this.config.pythonPath || process.env.WHISPER_PYTHON_PATH || "python3").trim();
        const scriptPath = path.resolve(process.cwd(), "scripts", "whisper_local_worker.py");
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`WhisperLocalASR: worker script not found at ${scriptPath}`);
        }
        logging_1.logger.info({ event: "WHISPER_LOCAL_WORKER_START", python, engine, model, scriptPath }, "whisper-local: starting worker");
        const child = (0, child_process_1.spawn)(python, [scriptPath, "--engine", engine, "--model", model], {
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env,
        });
        this.worker = child;
        child.on("exit", (code, signal) => {
            logging_1.logger.warn({ event: "WHISPER_LOCAL_WORKER_EXIT", code, signal }, "whisper-local: worker exited");
            // Reject any pending requests.
            for (const [id, pending] of this.pending.entries()) {
                pending.reject(new Error(`whisper-local worker exited (id=${id}, code=${code}, signal=${signal})`));
            }
            this.pending.clear();
            this.worker = null;
            this.rl?.close();
            this.rl = null;
        });
        child.stderr.on("data", (buf) => {
            // Forward worker stderr into structured logs for easier debugging.
            const msg = buf.toString("utf8").trim();
            if (msg)
                logging_1.logger.warn({ event: "WHISPER_LOCAL_WORKER_STDERR", msg }, "whisper-local: worker stderr");
        });
        const rl = readline.createInterface({ input: child.stdout });
        this.rl = rl;
        rl.on("line", (line) => {
            const trimmed = line.trim();
            if (!trimmed)
                return;
            let msg = null;
            try {
                msg = JSON.parse(trimmed);
            }
            catch (e) {
                logging_1.logger.warn({ event: "WHISPER_LOCAL_WORKER_BAD_JSON", line: trimmed }, "whisper-local: could not parse worker JSON");
                return;
            }
            // READY is informational.
            if (msg.event === "READY") {
                logging_1.logger.info({ event: "WHISPER_LOCAL_WORKER_READY", engine: msg.engine, model: msg.model }, "whisper-local: worker ready");
                return;
            }
            const id = msg.id;
            const pending = this.pending.get(id);
            if (!pending) {
                logging_1.logger.debug({ event: "WHISPER_LOCAL_WORKER_UNMATCHED", id }, "whisper-local: received response for unknown request id");
                return;
            }
            this.pending.delete(id);
            if (msg.ok === false) {
                const errMsg = msg.error || "Unknown worker error";
                logging_1.logger.error({ event: "WHISPER_LOCAL_WORKER_ERROR", id, err: errMsg, stack: msg.stack }, "whisper-local: worker error");
                pending.reject(new Error(errMsg));
                return;
            }
            const result = msg.result || {};
            pending.resolve({
                text: result.text ?? "",
                language: result.language,
            });
        });
    }
    stopWorker() {
        if (!this.worker)
            return;
        try {
            this.worker.kill();
        }
        catch {
            // ignore
        }
        this.worker = null;
        this.rl?.close();
        this.rl = null;
        this.pending.clear();
    }
}
exports.WhisperLocalASR = WhisperLocalASR;
//# sourceMappingURL=whisper-local.js.map