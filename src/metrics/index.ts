/**
 * High-signal metrics and watchdogs for production.
 * Counters and latencies are logged; watchdogs can trigger restarts.
 */

import { logger } from "../logging";

/** Last turn timing (ms). */
export interface TurnMetrics {
  asrLatencyMs?: number;
  llmLatencyMs?: number;
  ttsLatencyMs?: number;
  /** End of user speech to first bot audio (primary KPI). */
  endOfUserSpeechToBotAudioMs?: number;
}

/** Audio bridge / bot stats (from browser or Node). */
export interface AudioMetrics {
  rxBytes: number;
  txBytes: number;
  jitterBufferMs?: number;
  rxRms?: number;
}

let lastTurnMetrics: TurnMetrics = {};
let lastAudioMetrics: AudioMetrics = { rxBytes: 0, txBytes: 0 };

export function recordTurnMetrics(metrics: TurnMetrics): void {
  lastTurnMetrics = { ...lastTurnMetrics, ...metrics };
  logger.info(
    {
      event: "TURN_METRICS",
      asr_latency_ms: metrics.asrLatencyMs,
      llm_latency_ms: metrics.llmLatencyMs,
      tts_latency_ms: metrics.ttsLatencyMs,
      end_of_user_speech_to_bot_audio_ms: metrics.endOfUserSpeechToBotAudioMs,
    },
    "Turn latency"
  );
}

export function recordAudioMetrics(metrics: Partial<AudioMetrics>): void {
  if (metrics.rxBytes !== undefined) lastAudioMetrics.rxBytes = metrics.rxBytes;
  if (metrics.txBytes !== undefined) lastAudioMetrics.txBytes = metrics.txBytes;
  if (metrics.jitterBufferMs !== undefined) lastAudioMetrics.jitterBufferMs = metrics.jitterBufferMs;
  if (metrics.rxRms !== undefined) lastAudioMetrics.rxRms = metrics.rxRms;
}

export function getLastTurnMetrics(): TurnMetrics {
  return { ...lastTurnMetrics };
}

export function getLastAudioMetrics(): AudioMetrics {
  return { ...lastAudioMetrics };
}

/** Watchdog: check WS connected. Returns true if healthy. */
export type WSHealthCheck = () => boolean;

/** Watchdog: check conference/browser alive. Returns true if healthy. */
export type ConferenceHealthCheck = () => boolean;

/** Watchdog: check audio rx/tx increasing. Returns true if healthy. */
export type AudioHealthCheck = () => boolean;

export interface WatchdogConfig {
  /** Interval in ms. */
  intervalMs: number;
  /** Restart WS session if check fails this many times in a row. */
  wsFailCountBeforeRestart?: number;
  /** Restart browser/conference if check fails this many times. */
  conferenceFailCountBeforeRestart?: number;
  /** Restart audio pipeline if check fails this many times. */
  audioFailCountBeforeRestart?: number;
}

export interface WatchdogCallbacks {
  onWSUnhealthy?: () => void | Promise<void>;
  onConferenceUnhealthy?: () => void | Promise<void>;
  onAudioUnhealthy?: () => void | Promise<void>;
}

let wsFailCount = 0;
let conferenceFailCount = 0;
let audioFailCount = 0;

/**
 * Run one watchdog tick: run health checks and call restart callbacks if thresholds exceeded.
 */
export function runWatchdogTick(
  config: WatchdogConfig,
  callbacks: WatchdogCallbacks,
  checks: { ws: WSHealthCheck; conference?: ConferenceHealthCheck; audio?: AudioHealthCheck }
): void {
  const wsOk = checks.ws();
  if (!wsOk) {
    wsFailCount++;
    if (config.wsFailCountBeforeRestart != null && wsFailCount >= config.wsFailCountBeforeRestart) {
      logger.warn({ event: "WATCHDOG_WS_UNHEALTHY", failCount: wsFailCount }, "WS unhealthy; triggering restart");
      wsFailCount = 0;
      void Promise.resolve(callbacks.onWSUnhealthy?.()).catch((e) => logger.warn({ err: e }, "onWSUnhealthy error"));
    }
  } else {
    wsFailCount = 0;
  }

  if (checks.conference) {
    const confOk = checks.conference();
    if (!confOk) {
      conferenceFailCount++;
      if (config.conferenceFailCountBeforeRestart != null && conferenceFailCount >= config.conferenceFailCountBeforeRestart) {
        logger.warn({ event: "WATCHDOG_CONFERENCE_UNHEALTHY", failCount: conferenceFailCount }, "Conference unhealthy; triggering restart");
        conferenceFailCount = 0;
        void Promise.resolve(callbacks.onConferenceUnhealthy?.()).catch((e) => logger.warn({ err: e }, "onConferenceUnhealthy error"));
      }
    } else {
      conferenceFailCount = 0;
    }
  }

  if (checks.audio) {
    const audioOk = checks.audio();
    if (!audioOk) {
      audioFailCount++;
      if (config.audioFailCountBeforeRestart != null && audioFailCount >= config.audioFailCountBeforeRestart) {
        logger.warn({ event: "WATCHDOG_AUDIO_UNHEALTHY", failCount: audioFailCount }, "Audio unhealthy; triggering restart");
        audioFailCount = 0;
        void Promise.resolve(callbacks.onAudioUnhealthy?.()).catch((e) => logger.warn({ err: e }, "onAudioUnhealthy error"));
      }
    } else {
      audioFailCount = 0;
    }
  }
}
