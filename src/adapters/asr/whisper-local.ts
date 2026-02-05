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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as readline from "readline";
import type { IASR, StreamingSession, StreamingSessionOptions, TranscriptResult } from "./types";
import { pcmToWav } from "../../pipeline/audio-utils";
import { logger } from "../../logging";

export interface WhisperLocalConfig {
  /** Whisper model name or path (e.g. base, small). */
  model: string;
  /** Whisper engine selector. MVP supports faster-whisper worker only. */
  engine?: string;
  /** Optional python interpreter path (defaults to python3). */
  pythonPath?: string;
}

type WorkerRequest = { id: number; op: "transcribe"; audioPath: string };
type WorkerReady = { id: 0; ok: true; event: "READY"; engine: string; model: string };
type WorkerSuccess = { id: number; ok: true; result: { text?: string; language?: string } };
type WorkerFailure = { id: number; ok: false; error: string; stack?: string };
type WorkerMessage = WorkerReady | WorkerSuccess | WorkerFailure;

export class WhisperLocalASR implements IASR {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: TranscriptResult) => void; reject: (e: Error) => void }>();

  constructor(private readonly config: WhisperLocalConfig) {}

  /**
   * Transcribe audio to text.
   *
   * Supported formats:
   * - "wav" (default)
   * - "pcm16" (assumed 16kHz mono 16-bit little-endian)
   */
  async transcribe(audioBuffer: Buffer, format: string = "wav"): Promise<TranscriptResult> {
    const wav = this.normalizeToWav(audioBuffer, format);
    const tmpPath = path.join(os.tmpdir(), `whisper-local-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    try {
      await fs.promises.writeFile(tmpPath, wav);
      const result = await this.transcribeFile(tmpPath);
      return result;
    } finally {
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
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
  createStreamingSession(options: StreamingSessionOptions): StreamingSession {
    const sampleRateHz = options.sampleRateHz ?? 16000;
    const chunks: Buffer[] = [];
    return {
      push: (chunk: Buffer) => {
        chunks.push(chunk);
      },
      end: async () => {
        const pcm = Buffer.concat(chunks);
        // We treat pushed chunks as raw PCM16 mono.
        const wav = pcmToWav(pcm, sampleRateHz);
        // For MVP, no partials are emitted (Whisper hypotheses are not stable).
        return await this.transcribe(wav, "wav");
      },
    };
  }

  private normalizeToWav(audioBuffer: Buffer, format: string): Buffer {
    const fmt = (format || "wav").toLowerCase();
    if (fmt === "wav") return audioBuffer;
    if (fmt === "pcm16" || fmt === "pcm") {
      // The pipeline contract is 16kHz mono PCM16.
      return pcmToWav(audioBuffer, 16000);
    }
    throw new Error(`WhisperLocalASR: unsupported format '${format}'. Supported: wav | pcm16`);
  }

  private async transcribeFile(audioPath: string): Promise<TranscriptResult> {
    await this.ensureWorker();
    const id = this.nextId++;
    const req: WorkerRequest = { id, op: "transcribe", audioPath };

    const startedAt = Date.now();
    logger.debug({ event: "WHISPER_LOCAL_REQUEST", id, audioPath }, "whisper-local: sending transcribe request to worker");

    const p = new Promise<TranscriptResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.worker!.stdin.write(JSON.stringify(req) + "\n");

    try {
      const result = await p;
      logger.info(
        { event: "WHISPER_LOCAL_RESULT", id, textLength: result.text.length, durationMs: Date.now() - startedAt },
        "whisper-local: transcription completed"
      );
      return result;
    } catch (e) {
      logger.error({ event: "WHISPER_LOCAL_ERROR", id, err: (e as Error).message }, "whisper-local: transcription failed");
      throw e;
    }
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker && this.worker.exitCode == null) return;
    this.startWorker();
    // Wait briefly for READY so errors surface early in logs.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  private startWorker(): void {
    this.stopWorker();

    const engine = (this.config.engine || "faster-whisper").trim();
    const model = (this.config.model || "base").trim();
    const python = (this.config.pythonPath || process.env.WHISPER_PYTHON_PATH || "python3").trim();

    const scriptPath = path.resolve(process.cwd(), "scripts", "whisper_local_worker.py");
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`WhisperLocalASR: worker script not found at ${scriptPath}`);
    }

    logger.info({ event: "WHISPER_LOCAL_WORKER_START", python, engine, model, scriptPath }, "whisper-local: starting worker");

    const child = spawn(python, [scriptPath, "--engine", engine, "--model", model], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.worker = child;

    child.on("exit", (code, signal) => {
      logger.warn({ event: "WHISPER_LOCAL_WORKER_EXIT", code, signal }, "whisper-local: worker exited");
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
      if (msg) logger.warn({ event: "WHISPER_LOCAL_WORKER_STDERR", msg }, "whisper-local: worker stderr");
    });

    const rl = readline.createInterface({ input: child.stdout });
    this.rl = rl;
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: WorkerMessage | null = null;
      try {
        msg = JSON.parse(trimmed) as WorkerMessage;
      } catch (e) {
        logger.warn({ event: "WHISPER_LOCAL_WORKER_BAD_JSON", line: trimmed }, "whisper-local: could not parse worker JSON");
        return;
      }

      // READY is informational.
      if ((msg as WorkerReady).event === "READY") {
        logger.info({ event: "WHISPER_LOCAL_WORKER_READY", engine: (msg as WorkerReady).engine, model: (msg as WorkerReady).model }, "whisper-local: worker ready");
        return;
      }

      const id = (msg as WorkerSuccess | WorkerFailure).id;
      const pending = this.pending.get(id);
      if (!pending) {
        logger.debug({ event: "WHISPER_LOCAL_WORKER_UNMATCHED", id }, "whisper-local: received response for unknown request id");
        return;
      }
      this.pending.delete(id);

      if ((msg as WorkerFailure).ok === false) {
        const errMsg = (msg as WorkerFailure).error || "Unknown worker error";
        logger.error({ event: "WHISPER_LOCAL_WORKER_ERROR", id, err: errMsg, stack: (msg as WorkerFailure).stack }, "whisper-local: worker error");
        pending.reject(new Error(errMsg));
        return;
      }

      const result = (msg as WorkerSuccess).result || {};
      pending.resolve({
        text: result.text ?? "",
        language: result.language,
      });
    });
  }

  private stopWorker(): void {
    if (!this.worker) return;
    try {
      this.worker.kill();
    } catch {
      // ignore
    }
    this.worker = null;
    this.rl?.close();
    this.rl = null;
    this.pending.clear();
  }
}

