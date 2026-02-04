/**
 * Jitsi room implementation backed by a Playwright-controlled browser loading
 * a minimal bot join page. Node↔browser audio over WebSocket (48kHz 20ms frames);
 * Node resamples 48k→16k for onIncomingAudio.
 */

import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import type { JitsiConfig, IJitsiRoom } from "./jitsi";
import { pcmToWav } from "../pipeline/audio-utils";
import {
  BRIDGE_FRAME_BYTES,
  BRIDGE_FRAME_MS,
  VAD_SAMPLE_RATE,
  resample48kTo16k,
  chunk48k20ms,
} from "./audio-bridge-protocol";
import { logger } from "../logging";

const DEFAULT_BRIDGE_PORT = 8766;
const BRIDGE_PORT_RETRY_COUNT = 25;
const MAX_TX_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB of 48kHz s16le (~21s) safety cap.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function purgeOldFilesByMtime(dir: string, keepN: number, filenameIncludes?: string): void {
  if (keepN <= 0) return;
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        let mtimeMs = 0;
        try {
          const st = fs.statSync(full);
          mtimeMs = st.mtimeMs;
        } catch {
          // ignore
        }
        return { name, full, mtimeMs };
      })
      .filter((e) => !filenameIncludes || e.name.includes(filenameIncludes))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const e of entries.slice(keepN)) {
      try {
        fs.unlinkSync(e.full);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/** Strip protocol and path so libUrl and bot config always use a valid hostname. */
function domainHostOnly(domain: string): string {
  if (!domain || typeof domain !== "string") return domain;
  return domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || domain;
}

/**
 * Summarize a Playwright WS frame payload for logging (avoids dumping huge buffers of zeros).
 * Returns a small object with byte length and optional type; never the full buffer.
 */
function summarizePayload(payload: unknown): { payloadBytes: number; payloadType?: string } {
  if (Buffer.isBuffer(payload)) {
    return { payloadBytes: payload.length, payloadType: "Buffer" };
  }
  if (payload && typeof payload === "object" && "type" in payload && "data" in payload) {
    const data = (payload as { type: string; data: unknown }).data;
    const len = Array.isArray(data) ? data.length : 0;
    return { payloadBytes: len, payloadType: (payload as { type: string }).type };
  }
  return { payloadBytes: 0, payloadType: undefined };
}

export class JitsiBrowserBot implements IJitsiRoom {
  private readonly config: JitsiConfig;
  private onIncomingAudioCb: ((buffer: Buffer, sampleRate: number) => void) | null = null;
  private server: http.Server | null = null;
  private wss: import("ws").WebSocketServer | null = null;
  private ws: import("ws").WebSocket | null = null;
  private browser: import("playwright").Browser | null = null;
  private page: import("playwright").Page | null = null;
  private bridgePort = DEFAULT_BRIDGE_PORT;
  private txBuffer = Buffer.alloc(0);
  private txQueue: Buffer[] = [];
  private txInterval: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private rxBytesTotal = 0;
  private txBytesTotal = 0;
  private lastRxTxAt = 0;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private lastBotStatsWarnAt = 0;
  private jitsiJoinedAt = 0;
  private lastStats: Record<string, unknown> | null = null;
  private loggedTxFrameSample = false;
  private txSeq = 0;
  private readonly debugFrames = process.env.DEBUG_AUDIO_FRAMES === "1";
  private readonly saveWav = process.env.SAVE_TTS_WAV === "1";
  private readonly botDiag = process.env.BOT_DIAG === "1";
  private readonly botDiagDurationMs = envInt("BOT_DIAG_DURATION_MS", 20_000);
  private readonly artifactRetentionN = envInt("ARTIFACT_RETENTION_N", 10);
  private readonly preMixerPassThreshold = envInt("PRE_MIXER_PASS_THRESHOLD", 200);
  private readonly sessionId: string;
  private readonly conferenceId: string;
  private wavBuffers: Buffer[] = [];
  private wavBytes = 0;
  private wroteWav = false;
  /** Ring buffer for room-audio level diagnostic: last 5s of 16k resampled PCM. */
  private static readonly RX_LEVEL_RING_FRAMES = 250;
  private static readonly RX_LEVEL_FRAME_BYTES = 640; // 20ms at 16kHz
  private rxLevelRing: Buffer | null = null;
  private rxLevelFrameCount = 0;
  private lastRoomAudioSilentWarnAt = 0;
  private lastMixerLevelLogAt = 0;
  private lastNodeRoomAudioMaxAbs = 0;
  private lastTtsFrameSentAt = 0;
  private remoteTrackSeen = false;
  private consecutiveNoInboundProbes = 0;
  private consecutiveNoOutboundProbes = 0;

  // BOT_DIAG state (writes stats.jsonl and prints a verdict).
  private diagStatsStream: fs.WriteStream | null = null;
  private diagStatsPath: string | null = null;
  private diagStartedAt = 0;
  private diagTimer: ReturnType<typeof setTimeout> | null = null;
  private diagMaxInboundBytesDelta = 0;
  private diagMaxPreMixerMaxAbs = 0;
  private diagMaxPostMixerMaxAbs = 0;
  private diagMaxOutboundBytesDelta = 0;

  constructor(config: JitsiConfig) {
    this.config = config;
    this.sessionId = (process.env.SESSION_ID && process.env.SESSION_ID.trim()) || randomUUID();
    this.conferenceId = String(config.roomName || "");
  }

  onIncomingAudio(callback: (buffer: Buffer, sampleRate: number) => void): void {
    this.onIncomingAudioCb = callback;
  }

  /**
   * Accumulate resampled room audio and periodically log RMS/maxAbs so we can see if
   * Node is receiving non-silent audio (if levels are ~0, VAD will never fire).
   */
  private updateRoomAudioLevel(pcm16: Buffer): void {
    if (pcm16.length < JitsiBrowserBot.RX_LEVEL_FRAME_BYTES) return;
    if (!this.rxLevelRing) {
      this.rxLevelRing = Buffer.alloc(
        JitsiBrowserBot.RX_LEVEL_RING_FRAMES * JitsiBrowserBot.RX_LEVEL_FRAME_BYTES
      );
    }
    const ring = this.rxLevelRing;
    const slot = this.rxLevelFrameCount % JitsiBrowserBot.RX_LEVEL_RING_FRAMES;
    const offset = slot * JitsiBrowserBot.RX_LEVEL_FRAME_BYTES;
    pcm16.copy(ring, offset, 0, Math.min(pcm16.length, JitsiBrowserBot.RX_LEVEL_FRAME_BYTES));
    this.rxLevelFrameCount++;
    if (
      this.rxLevelFrameCount >= JitsiBrowserBot.RX_LEVEL_RING_FRAMES &&
      this.rxLevelFrameCount % JitsiBrowserBot.RX_LEVEL_RING_FRAMES === 0
    ) {
      let sumSq = 0;
      let maxAbs = 0;
      const len = ring.length & ~1;
      for (let i = 0; i + 2 <= len; i += 2) {
        const s = ring.readInt16LE(i);
        const a = Math.abs(s);
        if (a > maxAbs) maxAbs = a;
        sumSq += s * s;
      }
      const numSamples = len / 2;
      const rms = numSamples > 0 ? Math.sqrt(sumSq / numSamples) : 0;
      this.lastNodeRoomAudioMaxAbs = maxAbs;
      const isSilent = rms <= 0 && maxAbs <= 0;
      const now = Date.now();
      const ROOM_AUDIO_SILENT_WARN_INTERVAL_MS = 60_000;
      if (isSilent) {
        if (now - this.lastRoomAudioSilentWarnAt >= ROOM_AUDIO_SILENT_WARN_INTERVAL_MS) {
          this.lastRoomAudioSilentWarnAt = now;
          logger.warn(
            {
              event: "ROOM_AUDIO_RX_LEVEL",
              rms: 0,
              maxAbs: 0,
              frames: JitsiBrowserBot.RX_LEVEL_RING_FRAMES,
              windowSec: (JitsiBrowserBot.RX_LEVEL_RING_FRAMES * 20) / 1000,
            },
            "Room audio at Node is silent. Ensure the participant is unmuted in the meeting and their mic is working; check ROOM_MIXER_LEVEL (mixer_max_abs) in logs — if that is also 0, the remote track is silent in the browser."
          );
        }
      } else {
        this.lastRoomAudioSilentWarnAt = 0;
        logger.info(
          {
            event: "ROOM_AUDIO_RX_LEVEL",
            rms: Math.round(rms),
            maxAbs,
            frames: JitsiBrowserBot.RX_LEVEL_RING_FRAMES,
            windowSec: (JitsiBrowserBot.RX_LEVEL_RING_FRAMES * 20) / 1000,
          },
          "Room audio level at Node (if rms/maxAbs near 0, VAD will not detect speech; raise mic or lower VAD_ENERGY_THRESHOLD)"
        );
      }
    }
  }

  private startBotDiagIfEnabled(): void {
    if (!this.botDiag) return;
    if (this.diagStartedAt > 0) return;

    this.diagStartedAt = Date.now();
    const outDir = path.resolve(process.cwd(), "logs", "diag");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const safeConf = (this.conferenceId || "conf").replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
    const outPath = path.join(outDir, `${safeConf}_${this.sessionId}_stats.jsonl`);
    this.diagStatsPath = outPath;
    this.diagStatsStream = fs.createWriteStream(outPath, { flags: "a" });

    logger.info(
      {
        event: "BOT_DIAG_STARTED",
        sessionId: this.sessionId,
        conferenceId: this.conferenceId,
        durationMs: this.botDiagDurationMs,
        statsPath: outPath,
      },
      "BOT_DIAG enabled: collecting truth probes for diagnosis"
    );
    logger.info(
      { event: "BOT_DIAG_EXIT_NOTE", durationMs: this.botDiagDurationMs },
      "BOT_DIAG: process will exit after duration with verdict (OK → exit 0, otherwise exit 2)"
    );

    if (this.diagTimer) clearTimeout(this.diagTimer);
    this.diagTimer = setTimeout(() => this.finishBotDiag(), this.botDiagDurationMs);
  }

  private finishBotDiag(): void {
    if (!this.botDiag) return;
    if (this.diagStartedAt <= 0) return;

    const threshold = this.preMixerPassThreshold;
    const hasInbound = this.diagMaxInboundBytesDelta > 0;
    const premixOk = this.diagMaxPreMixerMaxAbs > threshold;
    const postmixOk = this.diagMaxPostMixerMaxAbs > 0;
    const nodeOk = this.lastNodeRoomAudioMaxAbs > 0;

    let receiveVerdict:
      | "NO_INBOUND_RTP"
      | "INBOUND_RTP_BUT_PREMIX_SILENT"
      | "PREMIX_OK_BUT_MIXER_SILENT"
      | "MIXER_OK_BUT_NODE_SILENT"
      | "OK" = "OK";
    if (!hasInbound) receiveVerdict = "NO_INBOUND_RTP";
    else if (!premixOk) receiveVerdict = "INBOUND_RTP_BUT_PREMIX_SILENT";
    else if (!postmixOk) receiveVerdict = "PREMIX_OK_BUT_MIXER_SILENT";
    else if (!nodeOk) receiveVerdict = "MIXER_OK_BUT_NODE_SILENT";

    const ttsSentDuringDiag = this.lastTtsFrameSentAt >= this.diagStartedAt;
    const publishOk = !ttsSentDuringDiag || this.diagMaxOutboundBytesDelta > 0;
    const verdict = receiveVerdict === "OK" && !publishOk ? "PUBLISH_BYTES_NOT_INCREASING" : receiveVerdict;

    const level = verdict === "OK" ? "info" : "warn";
    const verdictMsg =
      verdict === "INBOUND_RTP_BUT_PREMIX_SILENT"
        ? "BOT_DIAG verdict: inbound RTP but pre-mixer silent. Check statsPath for premixer_bindings/receiver_tracks; if boundVia is 'receiver' and track id matches audio_inbound_track_identifier, try BROWSER_HEADED=true (docs/AUDIO_DEBUGGING.md)."
        : "BOT_DIAG verdict (see statsPath for raw samples)";
    (logger as any)[level](
      {
        event: "BOT_DIAG_VERDICT",
        verdict,
        sessionId: this.sessionId,
        conferenceId: this.conferenceId,
        durationMs: Date.now() - this.diagStartedAt,
        preMixerPassThreshold: threshold,
        maxInboundBytesDelta: this.diagMaxInboundBytesDelta,
        maxPreMixerMaxAbs: this.diagMaxPreMixerMaxAbs,
        maxPostMixerMaxAbs: this.diagMaxPostMixerMaxAbs,
        maxOutboundBytesDelta: this.diagMaxOutboundBytesDelta,
        nodeRoomMaxAbs: this.lastNodeRoomAudioMaxAbs,
        statsPath: this.diagStatsPath,
      },
      verdictMsg
    );

    try {
      this.diagStatsStream?.end();
    } catch {
      // ignore
    }
    this.diagStatsStream = null;

    try {
      const outDir = path.resolve(process.cwd(), "logs", "diag");
      purgeOldFilesByMtime(outDir, this.artifactRetentionN, "_stats.jsonl");
      const audioDir = path.resolve(process.cwd(), "debug-audio");
      purgeOldFilesByMtime(audioDir, this.artifactRetentionN);
    } catch {
      // ignore
    }

    // Deterministic diagnostic mode: exit after printing verdict.
    setTimeout(() => process.exit(verdict === "OK" ? 0 : 2), 250);
  }

  private handleTruthProbe(msg: {
    ts?: number;
    sessionId?: string;
    conferenceId?: string;
    audio_inbound_bytes_delta?: number;
    audio_inbound_packets_delta?: number;
    audio_inbound_track_identifier?: string;
    inbound_mid?: string;
    pre_mixer_max_abs?: number;
    pre_mixer_by_track_id?: Record<string, number>;
    premixer_bindings?: Array<{ participantId?: string; requestedTrackId?: string; boundTrackId?: string; boundVia?: string; pre_mixer_max_abs?: number }>;
    receiver_tracks?: Array<{ id?: string; kind?: string; muted?: boolean; readyState?: string }>;
    post_mixer_max_abs?: number;
    outbound_audio_bytes_delta?: number;
    outbound_audio_bytes_sent?: number;
    outbound_audio_track_identifier?: string;
    selected_candidate_pair_state?: string;
    audio_transceivers?: unknown;
    audio_context_state?: string;
  }): void {
    const now = Date.now();
    const inboundBytesDelta = typeof msg.audio_inbound_bytes_delta === "number" ? msg.audio_inbound_bytes_delta : 0;
    const inboundPacketsDelta =
      typeof msg.audio_inbound_packets_delta === "number" ? msg.audio_inbound_packets_delta : 0;
    const preMix = typeof msg.pre_mixer_max_abs === "number" ? msg.pre_mixer_max_abs : 0;
    const postMix = typeof msg.post_mixer_max_abs === "number" ? msg.post_mixer_max_abs : 0;
    const outboundDelta = typeof msg.outbound_audio_bytes_delta === "number" ? msg.outbound_audio_bytes_delta : 0;

    // Update BOT_DIAG maxima and write raw samples.
    this.diagMaxInboundBytesDelta = Math.max(this.diagMaxInboundBytesDelta, inboundBytesDelta);
    this.diagMaxPreMixerMaxAbs = Math.max(this.diagMaxPreMixerMaxAbs, preMix);
    this.diagMaxPostMixerMaxAbs = Math.max(this.diagMaxPostMixerMaxAbs, postMix);
    this.diagMaxOutboundBytesDelta = Math.max(this.diagMaxOutboundBytesDelta, outboundDelta);
    if (this.diagStatsStream) {
      try {
        this.diagStatsStream.write(
          JSON.stringify({
            node_ts: now,
            sessionId: this.sessionId,
            conferenceId: this.conferenceId,
            ...msg,
          }) + "\n"
        );
      } catch {
        // ignore
      }
    }

    logger.info(
      {
        event: "TRUTH_PROBE",
        sessionId: this.sessionId,
        conferenceId: this.conferenceId,
        ts: msg.ts ?? now,
        audio_inbound_bytes_delta: inboundBytesDelta,
        audio_inbound_packets_delta: inboundPacketsDelta,
        pre_mixer_max_abs: preMix,
        pre_mixer_by_track_id: msg.pre_mixer_by_track_id,
        post_mixer_max_abs: postMix,
        outbound_audio_bytes_delta: outboundDelta,
        outbound_audio_bytes_sent: typeof msg.outbound_audio_bytes_sent === "number" ? msg.outbound_audio_bytes_sent : 0,
        selected_candidate_pair_state: msg.selected_candidate_pair_state,
        audio_context_state: msg.audio_context_state,
      },
      "Truth probe (RTP + pre/post mixer) from bot page"
    );

    // Receive contract (only meaningful when inbound bytes are increasing, or in BOT_DIAG mode).
    const threshold = this.preMixerPassThreshold;
    if (inboundBytesDelta > 0) {
      this.consecutiveNoInboundProbes = 0;
      const premixOk = preMix > threshold;
      const postmixOk = postMix > 0;
      if (!premixOk) {
        logger.warn(
          {
            event: "health_contract_receive",
            pass: false,
            reason: "WRONG_TRACK",
            sessionId: this.sessionId,
            conferenceId: this.conferenceId,
            audio_inbound_bytes_delta: inboundBytesDelta,
            pre_mixer_max_abs: preMix,
            post_mixer_max_abs: postMix,
            audio_inbound_track_identifier: msg.audio_inbound_track_identifier,
          },
          "Receive contract failed: inbound RTP present, but pre-mixer is silent (likely wrong track binding / phased negotiation)"
        );
      } else if (!postmixOk) {
        logger.warn(
          {
            event: "health_contract_receive",
            pass: false,
            reason: "MIXER_WIRING",
            sessionId: this.sessionId,
            conferenceId: this.conferenceId,
            audio_inbound_bytes_delta: inboundBytesDelta,
            pre_mixer_max_abs: preMix,
            post_mixer_max_abs: postMix,
          },
          "Receive contract failed: pre-mixer has audio, but post-mixer is silent (mixer wiring / pull issue)"
        );
      } else {
        logger.debug(
          {
            event: "health_contract_receive",
            pass: true,
            sessionId: this.sessionId,
            conferenceId: this.conferenceId,
            audio_inbound_bytes_delta: inboundBytesDelta,
            pre_mixer_max_abs: preMix,
            post_mixer_max_abs: postMix,
          },
          "Receive contract passed (inbound RTP and non-silent pre/post mixer)"
        );
      }
    } else if (this.remoteTrackSeen) {
      this.consecutiveNoInboundProbes++;
      // Avoid false alarms during silence: only warn after sustained no-inbound while a remote track exists.
      if (this.consecutiveNoInboundProbes >= 5 && !this.botDiag) {
        this.consecutiveNoInboundProbes = 0;
        logger.warn(
          {
            event: "health_contract_receive",
            pass: false,
            reason: "NO_INBOUND_RTP",
            sessionId: this.sessionId,
            conferenceId: this.conferenceId,
            consecutiveNoInboundProbes: 5,
          },
          "Receive contract: no inbound RTP observed for ~10s while remote tracks exist (may still be silence; run BOT_DIAG for deterministic verdict)"
        );
      }
    }

    // Publish contract: when we recently sent TTS frames, outbound bytes should increase.
    const ttsRecent = now - this.lastTtsFrameSentAt < 5000;
    if (ttsRecent) {
      if (outboundDelta <= 0) {
        this.consecutiveNoOutboundProbes++;
        if (this.consecutiveNoOutboundProbes >= 3 && !this.botDiag) {
          this.consecutiveNoOutboundProbes = 0;
          logger.warn(
            {
              event: "health_contract_publish",
              pass: false,
              reason: "PUBLISH_BYTES_NOT_INCREASING",
              sessionId: this.sessionId,
              conferenceId: this.conferenceId,
              outbound_audio_bytes_delta: outboundDelta,
              outbound_audio_bytes_sent: msg.outbound_audio_bytes_sent,
              outbound_audio_track_identifier: msg.outbound_audio_track_identifier,
            },
            "Publish contract failed: TTS frames sent, but outbound RTP bytesSent did not increase"
          );
        }
      } else {
        this.consecutiveNoOutboundProbes = 0;
        logger.debug(
          { event: "health_contract_publish", pass: true, sessionId: this.sessionId, conferenceId: this.conferenceId, outbound_audio_bytes_delta: outboundDelta },
          "Publish contract passed (outbound RTP bytesSent increased during TTS)"
        );
      }
    } else {
      this.consecutiveNoOutboundProbes = 0;
    }
  }

  private flushTxFrames(): void {
    if (this.closed) return;
    if (this.txBuffer.length < BRIDGE_FRAME_BYTES) return;
    const frames = chunk48k20ms(this.txBuffer);
    const consumed = frames.length * BRIDGE_FRAME_BYTES;
    this.txBuffer = consumed >= this.txBuffer.length ? Buffer.alloc(0) : this.txBuffer.subarray(consumed);
    for (const frame of frames) {
      // Copy: `frame` is a Buffer slice.
      this.txQueue.push(Buffer.from(frame));
    }
  }

  pushAudio(buffer: Buffer): void {
    if (this.closed) return;
    if (buffer.length === 0) return;

    // Debug-only: capture raw PCM sent toward the bot page so we can save a WAV and inspect it.
    if (this.saveWav && !this.wroteWav) {
      this.wavBuffers.push(buffer);
      this.wavBytes += buffer.length;
      // Cap capture to ~3 seconds at 48k mono s16le: 48000*2*3 = 288000 bytes.
      if (this.wavBytes >= 288000) {
        try {
          const pcm = Buffer.concat(this.wavBuffers, this.wavBytes);
          const wav = pcmToWav(pcm, 48000);
          const outDir = path.resolve(process.cwd(), "debug-audio");
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, `tts_node_tx_${Date.now()}.wav`);
          fs.writeFileSync(outPath, wav);
          logger.warn({ event: "AUDIO_WAV_SAVED", where: "node_tx", path: outPath, bytes: wav.length }, "Saved node TX WAV capture");
          this.wroteWav = true;
        } catch (e) {
          logger.warn({ event: "AUDIO_WAV_SAVE_FAILED", where: "node_tx", err: (e as Error).message }, "Failed saving node TX WAV");
        }
      }
    }

    this.txBuffer = Buffer.concat([this.txBuffer, buffer]);

    // Prevent unbounded buffering if the bridge isn't connected yet (or if TTS outruns WS).
    if (this.txBuffer.length > MAX_TX_BUFFER_BYTES) {
      const dropped = this.txBuffer.length - MAX_TX_BUFFER_BYTES;
      this.txBuffer = this.txBuffer.subarray(dropped);
      logger.warn({ event: "BOT_TX_BUFFER_DROPPED", droppedBytes: dropped }, "Dropping oldest buffered TTS audio (tx buffer cap)");
    }

    this.flushTxFrames();
  }

  /** True if browser and bridge are alive (for watchdog). */
  isAlive(): boolean {
    return !this.closed && this.browser != null && this.page != null && this.ws != null && this.ws.readyState === 1;
  }

  /** Rx/tx byte totals (for watchdog). */
  getRxTx(): { rx: number; tx: number } {
    return { rx: this.rxBytesTotal, tx: this.txBytesTotal };
  }

  async leave(): Promise<void> {
    this.closed = true;
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = null;
    if (this.txInterval) clearInterval(this.txInterval);
    this.txInterval = null;
    this.txQueue = [];
    if (this.page) try { await this.page.close(); } catch (e) { logger.warn({ err: e }, "Bot page close"); }
    this.page = null;
    if (this.browser) try { await this.browser.close(); } catch (e) { logger.warn({ err: e }, "Bot browser close"); }
    this.browser = null;
    if (this.ws) try { this.ws.close(); } catch (_) {}
    this.ws = null;
    if (this.wss) try { this.wss.close(); } catch (_) {}
    this.wss = null;
    if (this.server) await new Promise<void>((resolve) => { this.server!.close(() => resolve()); });
    this.server = null;
  }

  /** Start bridge server (HTTP + WebSocket), launch browser, load bot page; on WS connect send join. */
  async start(): Promise<void> {
    if (this.server) return;
    // Resolve bot-page relative to this file (dist/room/ -> project root -> bot-page) so it works regardless of cwd.
    const botPageDir = path.join(__dirname, "..", "..", "bot-page");
    const indexHtml = path.join(botPageDir, "bot.html");
    const indexJs = path.join(botPageDir, "bot.js");

    this.server = http.createServer((req, res) => {
      const rawUrl = req.url || "/";
      const pathname = rawUrl.split("?")[0];
      if (pathname.startsWith("/bridge")) {
        logger.info({ event: "HTTP_REQUEST_TO_BRIDGE_PATH", method: req.method, url: rawUrl }, "HTTP request to /bridge (expected WebSocket upgrade)");
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Use WebSocket to /bridge");
        return;
      }
      if (pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname === "/" || pathname === "/bot.html") {
        fs.readFile(indexHtml, (err, data) => {
          if (err) {
            logger.warn({ event: "BOT_PAGE_SERVE_ERROR", path: indexHtml, err: err.message }, "Failed to serve bot.html");
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data);
        });
        return;
      }
      if (pathname === "/bot.js") {
        fs.readFile(indexJs, (err, data) => {
          if (err) {
            logger.warn({ event: "BOT_PAGE_SERVE_ERROR", path: indexJs, err: err.message }, "Failed to serve bot.js");
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/javascript" });
          res.end(data);
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    const { WebSocketServer } = await import("ws");
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (request, socket, head) => {
      logger.info(
        { event: "HTTP_UPGRADE", url: request.url, origin: request.headers.origin, host: request.headers.host },
        "HTTP upgrade request received"
      );
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (url.pathname === "/bridge") {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    const startPort = this.config.bridgePort ?? DEFAULT_BRIDGE_PORT;
    const maxPort = startPort + BRIDGE_PORT_RETRY_COUNT - 1;
    let bound = false;
    for (let port = startPort; port <= maxPort; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException) => {
            this.server!.removeListener("error", onError);
            reject(err);
          };
          this.server!.once("error", onError);
          // Bind to 0.0.0.0 so headless browser can connect in WSL2 (loopback can be flaky).
          this.server!.listen(port, "0.0.0.0", () => {
            this.server!.removeListener("error", onError);
            this.bridgePort = port;
            bound = true;
            resolve();
          });
        });
        if (port !== startPort) {
          logger.info({ event: "BRIDGE_PORT_BOUND", port, previousPortInUse: startPort }, "Bridge bound to port (default was in use)");
        }
        break;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EADDRINUSE" && port < maxPort) {
          logger.warn({ event: "BRIDGE_PORT_IN_USE", port }, "Port in use, trying next");
          continue;
        }
        throw err;
      }
    }
    if (!bound) {
      // As a last resort, bind to an ephemeral port chosen by the OS.
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          this.server!.removeListener("error", onError);
          reject(err);
        };
        this.server!.once("error", onError);
        this.server!.listen(0, "0.0.0.0", () => {
          this.server!.removeListener("error", onError);
          const addr = this.server!.address();
          if (addr && typeof addr === "object") this.bridgePort = addr.port;
          bound = true;
          resolve();
        });
      });
      logger.warn(
        { event: "BRIDGE_PORT_BOUND_RANDOM", port: this.bridgePort, attemptedStartPort: startPort, attemptedMaxPort: maxPort },
        "Bridge bound to random port after conflicts"
      );
    }

    const BRIDGE_CONNECT_TIMEOUT_MS = 15000;
    let resolveBridgeConnected: () => void;
    const bridgeConnectedPromise = new Promise<void>((resolve) => {
      resolveBridgeConnected = resolve;
    });

    this.wss.on("connection", (ws: import("ws").WebSocket) => {
      this.ws = ws;
      resolveBridgeConnected();
      ws.binaryType = "nodebuffer";
      ws.on("message", (data: Buffer | string) => {
        if (this.closed) return;
        if (Buffer.isBuffer(data) && data.length === BRIDGE_FRAME_BYTES) {
          this.rxBytesTotal += data.length;
          this.lastRxTxAt = Date.now();
          const pcm16 = resample48kTo16k(data);
          this.updateRoomAudioLevel(pcm16);
          this.onIncomingAudioCb?.(pcm16, VAD_SAMPLE_RATE);
          return;
        }
        try {
          const str = typeof data === "string" ? data : data.toString("utf8");
          const msg = JSON.parse(str) as {
            type?: string;
            success?: boolean;
            error?: string;
            participantId?: string;
            track_id?: string;
            track_readyState?: string;
            track_enabled?: boolean;
            track_muted?: boolean;
            rx_bytes?: number;
            stats?: Record<string, unknown>;
            // truth_probe (bot-page → Node, every ~2s)
            sessionId?: string;
            conferenceId?: string;
            ts?: number;
            audio_inbound_bytes_delta?: number;
            audio_inbound_packets_delta?: number;
            audio_inbound_track_identifier?: string;
            pre_mixer_max_abs?: number;
            post_mixer_max_abs?: number;
            outbound_audio_bytes_delta?: number;
            outbound_audio_bytes_sent?: number;
            outbound_audio_track_identifier?: string;
            selected_candidate_pair_state?: string;
            audio_transceivers?: unknown;
            message?: string;
            name?: string;
            stack?: string;
            filename?: string;
            lineno?: number;
            colno?: number;
            seq?: number;
            xorHeader?: number;
            xorComputed?: number;
            maxAbs?: number;
            nonZero?: number;
            pcm48?: string;
            label?: string;
            pcm48_b64?: string;
          };
          if (msg.type === "join_result") {
            if (msg.success) {
              this.jitsiJoinedAt = this.jitsiJoinedAt || Date.now();
              logger.info({ event: "BOT_JITSI_JOINED" }, "Bot joined Jitsi conference");
              this.startBotDiagIfEnabled();
            } else {
              logger.error({ event: "BOT_JITSI_JOIN_FAILED", error: msg.error }, "Bot failed to join Jitsi: " + (msg.error ?? "unknown"));
            }
          } else if (msg.type === "join_error") {
            logger.error({ event: "BOT_JOIN_ERROR", error: msg.error }, "Bot join failed (e.g. script load): " + (msg.error ?? "unknown"));
          } else if (msg.type === "page_error") {
            logger.error(
              {
                event: "BOT_PAGE_ERROR_DETAIL",
                name: msg.name,
                message: msg.message,
                filename: msg.filename,
                lineno: msg.lineno,
                colno: msg.colno,
                stack: msg.stack,
              },
              "Bot page window.onerror"
            );
          } else if (msg.type === "unhandled_rejection") {
            logger.error(
              { event: "BOT_PAGE_UNHANDLED_REJECTION", name: msg.name, message: msg.message, stack: msg.stack },
              "Bot page unhandled rejection"
            );
          } else if (msg.type === "track_disposed") {
            logger.warn({ event: "BOT_TRACK_DISPOSED", detail: msg }, "Bot synthetic track disposed unexpectedly");
          } else if (msg.type === "frame_ack") {
            logger.warn(
              {
                event: "BOT_FRAME_ACK",
                seq: msg.seq,
                xorHeader: msg.xorHeader,
                xorComputed: msg.xorComputed,
                maxAbs: msg.maxAbs,
                nonZero: msg.nonZero,
              },
              "Bot page received debug audio frame"
            );
          } else if (msg.type === "remote_track_added") {
            this.remoteTrackSeen = true;
            logger.info(
              {
                event: "BOT_REMOTE_TRACK_ADDED",
                participantId: msg.participantId ?? "",
                track_id: msg.track_id,
                track_readyState: msg.track_readyState,
                track_enabled: msg.track_enabled,
                track_muted: msg.track_muted,
              },
              "Bot attached remote participant audio to mixer (room audio in)"
            );
          } else if (msg.type === "track_rebind") {
            logger.info(
              {
                event: "BOT_TRACK_REBIND",
                sessionId: this.sessionId,
                conferenceId: this.conferenceId,
                inbound_track_identifier: (msg as any).inbound_track_identifier,
                participantId: msg.participantId ?? "",
                track_id: msg.track_id,
              },
              "Bot page rebound remote track based on inbound RTP trackIdentifier"
            );
          } else if (msg.type === "receiver_track_used") {
            logger.info(
              {
                event: "BOT_RECEIVER_TRACK_USED",
                sessionId: this.sessionId,
                conferenceId: this.conferenceId,
                track_id: (msg as any).track_id,
                participantId: (msg as any).participantId ?? "",
              },
              "Bot using PC receiver track for mixer (not Jitsi wrapper)"
            );
          } else if (msg.type === "track_rebind_receiver") {
            logger.info(
              {
                event: "BOT_TRACK_REBIND_RECEIVER",
                sessionId: this.sessionId,
                conferenceId: this.conferenceId,
                inbound_track_identifier: (msg as any).inbound_track_identifier,
                boundTrackId: (msg as any).boundTrackId ?? "",
              },
              "Bot rebound mixer to receiver track (inbound RTP present but premixer was silent)"
            );
          } else if (msg.type === "rx_audio_started") {
            logger.info(
              { event: "BOT_RX_AUDIO_STARTED", rx_bytes: msg.rx_bytes ?? 0 },
              "Room audio in: first bytes received from mixer (speak unmuted to get USER_TRANSCRIPT)"
            );
          } else if (msg.type === "truth_probe") {
            this.handleTruthProbe(msg);
          } else if (msg.type === "stats" && msg.stats) {
            this.lastStats = msg.stats;
            const now = Date.now();
            const mixerMaxAbs = typeof msg.stats.mixer_max_abs === "number" ? msg.stats.mixer_max_abs : undefined;
            if (mixerMaxAbs !== undefined && now - this.lastMixerLevelLogAt >= 10_000) {
              this.lastMixerLevelLogAt = now;
              logger.info(
                { event: "ROOM_MIXER_LEVEL", mixer_max_abs: mixerMaxAbs },
                "Room mixer output level in browser (0 = remote track silent; ensure participant is unmuted)"
              );
            }
            // Only warn on suspicious states; suppress during grace period and when outbound is clearly healthy.
            const STATS_GRACE_MS = 30_000;
            const HEALTHY_OUT_THRESHOLD = 50_000;

            const confState = typeof msg.stats.conference_state === "string" ? msg.stats.conference_state : "";
            const audioCtx = typeof msg.stats.audio_context_state === "string" ? msg.stats.audio_context_state : "";
            const iceState = typeof msg.stats.ice_state === "string" ? msg.stats.ice_state : "";
            const pcState = typeof msg.stats.pc_connection_state === "string" ? msg.stats.pc_connection_state : "";
            const outAudioSent = typeof msg.stats.out_audio_bytes_sent === "number" ? msg.stats.out_audio_bytes_sent : 0;
            const txBytesFromPage = typeof msg.stats.tx_bytes === "number" ? msg.stats.tx_bytes : 0;
            const txRms = typeof msg.stats.tx_rms === "number" ? msg.stats.tx_rms : undefined;
            const txFrameRms = typeof msg.stats.tx_frame_rms === "number" ? msg.stats.tx_frame_rms : undefined;
            const txFrameMaxAbs = typeof msg.stats.tx_frame_max_abs === "number" ? msg.stats.tx_frame_max_abs : undefined;
            const txFrameNonZero = typeof msg.stats.tx_frame_nonzero === "number" ? msg.stats.tx_frame_nonzero : undefined;
            const txFrameXor = typeof msg.stats.tx_frame_xor === "number" ? msg.stats.tx_frame_xor : undefined;

            const inGracePeriod = this.jitsiJoinedAt > 0 && now - this.jitsiJoinedAt < STATS_GRACE_MS;
            const outboundHealthy = outAudioSent >= HEALTHY_OUT_THRESHOLD && pcState === "connected";

            const critical =
              (confState && confState !== "joined") ||
              (audioCtx && audioCtx !== "running") ||
              (iceState && (iceState === "failed" || iceState === "disconnected")) ||
              (this.txBytesTotal > 0 && txBytesFromPage === 0);

            const silentPath =
              !outboundHealthy &&
              ((txBytesFromPage > 0 && txRms !== undefined && txRms <= 0.0001) ||
                (txBytesFromPage > 0 && txFrameRms !== undefined && txFrameRms <= 0.0001) ||
                (txBytesFromPage > 0 && txFrameMaxAbs !== undefined && txFrameMaxAbs === 0) ||
                (txBytesFromPage > 0 && txFrameNonZero !== undefined && txFrameNonZero === 0) ||
                (txBytesFromPage > 0 && txFrameXor !== undefined && txFrameXor === 0));

            const shouldWarn = !inGracePeriod && (critical || silentPath);
            if (shouldWarn && now - this.lastBotStatsWarnAt > 60_000) {
              this.lastBotStatsWarnAt = now;
              logger.warn({ event: "BOT_PAGE_STATS_WARN", stats: msg.stats }, "Bot page stats indicate potential audio/connectivity issue");
            }
          } else if (msg.type === "wav_capture" && typeof msg.pcm48_b64 === "string") {
            try {
              let label = (msg.label ?? "page").replace(/[^a-z0-9_-]/gi, "_");
              if (this.botDiag) {
                // Make BOT_DIAG artifacts self-explanatory.
                if (label === "page_rx") label = "room_rx";
                if (label === "page_out") label = "tts_out";
              }
              const pcm = Buffer.from(msg.pcm48_b64, "base64");
              const wav = pcmToWav(pcm, 48000);
              const outDir = this.botDiag ? path.resolve(process.cwd(), "logs", "diag") : path.resolve(process.cwd(), "debug-audio");
              if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
              const safeConf = (this.conferenceId || "conf").replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
              const outPath = path.join(outDir, `${safeConf}_${this.sessionId}_${label}_${Date.now()}.wav`);
              fs.writeFileSync(outPath, wav);
              logger.warn(
                { event: "AUDIO_WAV_SAVED", sessionId: this.sessionId, conferenceId: this.conferenceId, where: label, path: outPath, bytes: wav.length },
                "Saved page WAV capture"
              );
              purgeOldFilesByMtime(outDir, this.artifactRetentionN);
            } catch (e) {
              logger.warn({ event: "AUDIO_WAV_SAVE_FAILED", where: "page", err: (e as Error).message }, "Failed saving page WAV");
            }
          }
        } catch {
          // ignore non-JSON or parse errors
        }
      });
      ws.on("close", (code?: number, reason?: Buffer) => {
        const reasonStr = reason && reason.length > 0 ? reason.toString("utf8") : undefined;
        logger.warn(
          { event: "BOT_BRIDGE_DISCONNECTED", code, reason: reasonStr },
          "Bot bridge WebSocket closed — bot has left the call from the room's perspective; restart process to rejoin"
        );
        this.ws = null;
      });

      // If TTS was produced before the bridge connected, flush it now.
      this.flushTxFrames();

      // Start paced sender: send exactly one 20ms frame per tick.
      if (this.txInterval) clearInterval(this.txInterval);
      this.txInterval = setInterval(() => {
        try {
          if (this.closed || !this.ws || this.ws.readyState !== 1) return;
          const frame = this.txQueue.shift();
          if (!frame) return;

          // Contract check (debug): log a single sample of outgoing PCM to ensure it isn't all-zero at send time.
          if (!this.loggedTxFrameSample && frame.length === BRIDGE_FRAME_BYTES) {
            this.loggedTxFrameSample = true;
            let maxAbs = 0;
            let nonZero = 0;
            let xor = 0;
            for (let off = 0; off + 2 <= frame.length; off += 2) {
              const s = frame.readInt16LE(off);
              const a = Math.abs(s);
              if (a > maxAbs) maxAbs = a;
              if (s !== 0) nonZero++;
            }
            for (let i = 0; i < frame.length; i++) xor ^= frame[i]!;
            logger.warn(
              { event: "BOT_TX_FRAME_SAMPLE", frameBytes: frame.length, maxAbs, nonZero, xor },
              "Outgoing bridge frame sample (s16le) for contract verification"
            );
          }

          if (this.debugFrames) {
            const seq = this.txSeq++ >>> 0;
            let xor = 0;
            for (let i = 0; i < frame.length; i++) xor ^= frame[i]!;
            const header = Buffer.allocUnsafe(5);
            header.writeUInt32LE(seq, 0);
            header.writeUInt8(xor & 0xff, 4);
            this.ws.send(Buffer.concat([header, frame]));
          } else {
            this.ws.send(frame);
          }
          this.lastTtsFrameSentAt = Date.now();
          this.txBytesTotal += frame.length;
          this.lastRxTxAt = Date.now();
        } catch {
          // ignore
        }
      }, BRIDGE_FRAME_MS);

      // Poll for bot stats (jitter buffer, AudioContext state). Warn only when unhealthy.
      if (this.statsInterval) clearInterval(this.statsInterval);
      this.statsInterval = setInterval(() => {
        try {
          if (this.closed || !this.ws || this.ws.readyState !== 1) return;
          this.ws.send(JSON.stringify({ type: "get_stats" }));
        } catch {
          // ignore
        }
      }, 5000);

      const host = domainHostOnly(this.config.domain);
      const joinConfig: Record<string, unknown> = {
        domain: host,
        xmppDomain: this.config.xmppDomain,
        mucDomain: this.config.mucDomain,
        roomName: this.config.roomName,
        sessionId: this.sessionId,
        conferenceId: this.conferenceId,
        botDiag: this.botDiag,
        user: this.config.user,
        creatorUuid: this.config.creatorUuid,
        cohostUuids: this.config.cohostUuids,
        libUrl: `https://${host}/libs/lib-jitsi-meet.min.js`,
      };
      if (this.config.jwt) joinConfig.jwt = this.config.jwt;
      ws.send(JSON.stringify({ type: "join", config: joinConfig }));
      logger.info(
        { event: "BOT_JOIN_SENT", sessionId: this.sessionId, conferenceId: this.conferenceId, domain: host, xmppDomain: this.config.xmppDomain, roomName: this.config.roomName },
        "Sent join to bot page"
      );
    });

    const playwright = await import("playwright");
    const headed = process.env.BROWSER_HEADED === "true" || process.env.BROWSER_HEADED === "1";
    if (headed) {
      logger.info({ event: "BROWSER_HEADED" }, "Launching Chromium in headed mode (requires DISPLAY, e.g. Xvfb); use for reliable remote audio in the mixer");
    }
    this.browser = await playwright.chromium.launch({
      headless: !headed,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=AudioServiceOutOfProcess",
        "--no-sandbox",
        "--disable-web-security",
        "--disable-features=BlockInsecurePrivateNetworkRequests",
      ],
    });
    const context = await this.browser.newContext({
      permissions: ["microphone"],
      ignoreHTTPSErrors: true,
    });
    this.page = await context.newPage();
    this.page.on("close", () => {
      logger.warn({ event: "BOT_PAGE_CLOSED" }, "Bot page closed (browser tab/crash) — bot has left the call; restart process to rejoin");
    });
    this.page.on("pageerror", (err) => {
      logger.warn(
        { event: "BOT_PAGE_ERROR", name: (err as Error).name, message: err.message, stack: (err as Error).stack },
        "Bot page JS error: " + err.message
      );
    });
    this.page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();
      // Forward only high-signal console output at warn/error. Everything else is debug to avoid log floods.
      if (type === "error") {
        logger.error({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
      } else if (type === "warning") {
        logger.warn({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
      } else {
        logger.debug({ event: "BOT_CONSOLE", type, text }, "Bot console: " + type + " " + text);
      }
    });
    this.page.on("websocket", (ws) => {
      logger.info({ event: "PW_WEBSOCKET_CREATED", url: ws.url() }, "Playwright: WebSocket created");
      ws.on("framesent", (e) =>
        logger.debug(
          { event: "PW_WS_SENT", ...summarizePayload(e.payload) },
          "PW WS sent"
        )
      );
      ws.on("framereceived", (e) =>
        logger.debug(
          { event: "PW_WS_RECV", ...summarizePayload(e.payload) },
          "PW WS recv"
        )
      );
      ws.on("close", () => logger.info({ event: "PW_WS_CLOSE" }, "Playwright: WebSocket closed"));
    });
    // If BOT_PAGE_URL is set, make it robust:
    // - Ensure it points at the actual bridge port when using localhost/127.0.0.1.
    // - Ensure the bot page has the ?ws= bridge param; otherwise it defaults to ws://127.0.0.1:8766/bridge and breaks if port differs.
    const defaultPageUrl = `http://127.0.0.1:${this.bridgePort}/bot.html?ws=ws://127.0.0.1:${this.bridgePort}/bridge`;
    let pageUrl = defaultPageUrl;
    if (!this.config.botPageUrl && (process.env.SAVE_TTS_WAV === "1" || this.botDiag)) {
      try {
        const u = new URL(pageUrl);
        if (!u.searchParams.has("saveWav")) u.searchParams.set("saveWav", "1");
        pageUrl = u.toString();
      } catch {
        // ignore
      }
    }
    if (this.config.botPageUrl) {
      try {
        const u = new URL(this.config.botPageUrl);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          u.hostname = "127.0.0.1";
          u.port = String(this.bridgePort);
        }
        if (!u.searchParams.has("ws")) {
          u.searchParams.set("ws", `ws://127.0.0.1:${this.bridgePort}/bridge`);
        }
        // Debug-only: enable WAV capture from bot page.
        if ((process.env.SAVE_TTS_WAV === "1" || this.botDiag) && !u.searchParams.has("saveWav")) {
          u.searchParams.set("saveWav", "1");
        }
        pageUrl = u.toString();
      } catch {
        // Fall back to the known-good default if the URL is invalid.
        pageUrl = defaultPageUrl;
      }
    }
    await this.page.goto(pageUrl, { waitUntil: "load", timeout: 15000 });
    logger.info({ event: "BOT_PAGE_LOADED", url: pageUrl }, "Bot page loaded");
    const userAgent = await this.page.evaluate("navigator.userAgent");
    logger.info({ event: "BOT_PAGE_USER_AGENT", userAgent }, "Bot page user agent");

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Headless bot page did not connect to bridge within " + BRIDGE_CONNECT_TIMEOUT_MS / 1000 + "s")), BRIDGE_CONNECT_TIMEOUT_MS);
    });
    await Promise.race([bridgeConnectedPromise, timeoutPromise]).catch((err) => {
      logger.error({ event: "BOT_BRIDGE_CONNECT_TIMEOUT", timeoutMs: BRIDGE_CONNECT_TIMEOUT_MS }, (err as Error).message);
      throw err;
    });
    logger.info({ event: "BOT_BRIDGE_CONNECTED" }, "Bot page connected to bridge");
  }
}
