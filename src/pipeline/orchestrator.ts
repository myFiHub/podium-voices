/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */

import type { IASR } from "../adapters/asr";
import type { ILLM, Message } from "../adapters/llm";
import type { ITTS, VoiceOptions } from "../adapters/tts";
import type { PersonaPlexClient } from "../adapters/personaplex";
import { getCadencePersona } from "../prompts/cadence-personas";
import type { ISessionMemory } from "../memory/types";
import type { ICoordinatorClient } from "../coordinator/client";
import type { PipelineCallbacks } from "./types";
import { VAD } from "./vad";
import { pcmToWav } from "./audio-utils";
import { PromptManager } from "../prompts/prompt-manager";
import { ttsToStream } from "../adapters/tts";
import { recordTurnMetrics } from "../metrics";
import { SafetyGate } from "./safety";
import { logger } from "../logging";
import { flushSentences, DEFAULT_MAX_CHARS_PER_CHUNK } from "./sentence-splitter";
import { chooseFiller, streamFillerClip } from "./fillerEngine";
import type { FillerEngineConfig } from "./fillerEngine";
import { updateRunningSummary } from "../memory/running-summary";

const DEFAULT_ASR_TIMEOUT_MS = 20_000;
const DEFAULT_LLM_TIMEOUT_MS = 25_000;

/** Reply max tokens by feedback behavior: high_negative gets a lower cap for short, reset-style replies. */
const REPLY_MAX_TOKENS_HIGH_NEGATIVE = 80;
const REPLY_MAX_TOKENS_DEFAULT = 150;

function getReplyMaxTokens(behaviorLevel: "high_positive" | "positive" | "neutral" | "negative" | "high_negative"): number {
  if (behaviorLevel === "high_negative") return REPLY_MAX_TOKENS_HIGH_NEGATIVE;
  return REPLY_MAX_TOKENS_DEFAULT;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export interface OrchestratorConfig {
  vadSilenceMs: number;
  /** Energy-based VAD threshold (when webrtcvad unavailable); lower = more sensitive. */
  vadEnergyThreshold?: number;
  /** WebRTC VAD aggressiveness 0–3 (only when webrtcvad native module is used). */
  vadAggressiveness?: number;
  /** Conversation backend: default ASR+LLM+TTS, or PersonaPlex speech-to-speech. */
  conversationBackendMode?: "asr-llm-tts" | "personaplex";
  /** PersonaPlex client used when conversationBackendMode === 'personaplex'. */
  personaplexClient?: PersonaPlexClient;
  /** If true, fall back to ASR+LLM+TTS when PersonaPlex fails. */
  personaplexFallbackToLlm?: boolean;
  /** Feedback sentiment for this turn (cheer | boo | neutral). */
  getFeedbackSentiment?: () => "cheer" | "boo" | "neutral";
  /** Threshold-derived feedback behavior level for this turn (high_positive..high_negative). */
  getFeedbackBehaviorLevel?: () => "high_positive" | "positive" | "neutral" | "negative" | "high_negative";
  /** Prompt builder; defaults to PromptManager with CO_HOST_SYSTEM_PROMPT. */
  promptManager?: PromptManager;
  /** Safety guardrails; defaults to SafetyGate. */
  safetyGate?: SafetyGate;
  /** Timeouts for external calls. */
  timeouts?: { asrMs?: number; llmMs?: number };
  /** Multi-agent: Turn Coordinator client. When set, agent syncs memory and requests turn before replying. */
  coordinatorClient?: ICoordinatorClient;
  /** Optional filler engine config for latency masking (play short clip before main reply). */
  fillerConfig?: FillerEngineConfig;
  /** Persona ID for filler selection (e.g. "default", "hype", "orator"). */
  personaId?: string;
  /** When set, TTS uses this cadence profile (personas/*.json) for rate/pitch. Typically same as personaId for cadence personas. */
  cadenceProfileId?: string;
  /** Session id for running-summary persistence (set after join, e.g. outpostUuid + start time). */
  sessionId?: string;
  /** Run running summary every N assistant turns (default 10). */
  runningSummaryTurnInterval?: number;
  /** Enable running summary and persistence (default true). */
  runningSummaryEnabled?: boolean;
}

export class Orchestrator {
  private vad: VAD;
  private audioBuffer: Buffer[] = [];
  private processing = false;
  private speaking = false;
  private cancelTts = false;
  /** When barge-in was signaled (for bargeInStopLatencyMs). */
  private bargeInAt: number | undefined;
  private pendingSegment: Buffer | null = null;
  private activeStreamingSession: ReturnType<NonNullable<IASR["createStreamingSession"]>> | null = null;
  /** Set when ASR emits end_of_turn_predicted so VAD path skips this segment. */
  private turnHandledByAsrEvent = false;
  /** Log VAD_SPEECH_STARTED only once per speech run (debug). */
  private vadSpeechLogged = false;
  private readonly getFeedbackSentiment: () => "cheer" | "boo" | "neutral";
  private readonly getFeedbackBehaviorLevel: () => "high_positive" | "positive" | "neutral" | "negative" | "high_negative";
  private readonly promptManager: PromptManager;
  private readonly safety: SafetyGate;
  private readonly timeouts: { asrMs: number; llmMs: number };
  private readonly coordinatorClient?: ICoordinatorClient;
  private readonly backendMode: "asr-llm-tts" | "personaplex";
  private readonly personaplexClient?: PersonaPlexClient;
  private readonly personaplexFallbackToLlm: boolean;
  private readonly fillerConfig?: FillerEngineConfig;
  private readonly personaId: string;
  private readonly cadenceProfileId?: string;
  /** Set when main TTS starts so filler playback aborts. */
  private fillerAbort = false;
  /** Session id for running-summary persistence; set from main after join. */
  private sessionId: string | undefined = undefined;
  private runningSummaryTurnInterval = 10;
  private runningSummaryEnabled = true;
  /** Count of assistant turns (for running summary every N turns). */
  private assistantTurnCount = 0;

  constructor(
    private readonly asr: IASR,
    private readonly llm: ILLM,
    private readonly tts: ITTS,
    private readonly memory: ISessionMemory,
    private readonly config: OrchestratorConfig,
    private readonly callbacks: PipelineCallbacks = {}
  ) {
    this.vad = new VAD({
      silenceMs: config.vadSilenceMs,
      aggressiveness: config.vadAggressiveness ?? 1,
      energyThreshold: config.vadEnergyThreshold,
    });
    this.getFeedbackSentiment = config.getFeedbackSentiment ?? (() => "neutral");
    this.getFeedbackBehaviorLevel = config.getFeedbackBehaviorLevel ?? (() => "neutral");
    this.promptManager = config.promptManager ?? new PromptManager();
    this.safety = config.safetyGate ?? new SafetyGate();
    this.timeouts = {
      asrMs: config.timeouts?.asrMs ?? DEFAULT_ASR_TIMEOUT_MS,
      llmMs: config.timeouts?.llmMs ?? DEFAULT_LLM_TIMEOUT_MS,
    };
    this.coordinatorClient = config.coordinatorClient;
    this.backendMode = config.conversationBackendMode ?? "asr-llm-tts";
    this.personaplexClient = config.personaplexClient;
    this.personaplexFallbackToLlm = Boolean(config.personaplexFallbackToLlm);
    this.fillerConfig = config.fillerConfig;
    this.personaId = config.personaId ?? "default";
    this.cadenceProfileId = config.cadenceProfileId;
    this.sessionId = config.sessionId;
    this.runningSummaryTurnInterval = config.runningSummaryTurnInterval ?? 10;
    this.runningSummaryEnabled = config.runningSummaryEnabled !== false;
  }

  /** Set session id and running-summary config (call from main after room join). */
  setRunningSummaryConfig(sessionId: string, interval: number, enabled: boolean): void {
    this.sessionId = sessionId;
    this.runningSummaryTurnInterval = interval;
    this.runningSummaryEnabled = enabled;
  }

  /** After each assistant reply turn: increment count and optionally run running summary (async, non-blocking). */
  private maybeScheduleRunningSummary(): void {
    this.assistantTurnCount++;
    if (
      !this.runningSummaryEnabled ||
      !this.sessionId ||
      this.runningSummaryTurnInterval <= 0 ||
      this.assistantTurnCount % this.runningSummaryTurnInterval !== 0
    ) {
      return;
    }
    const memoryWithSummary = this.memory as ISessionMemory & { setRunningSummary(s: string | undefined): void };
    void updateRunningSummary(memoryWithSummary, this.llm, this.sessionId).catch((err) =>
      logger.warn({ event: "RUNNING_SUMMARY_SCHEDULE_FAILED", err: (err as Error).message }, "Running summary schedule failed")
    );
  }

  /** Voice options for TTS: sample rate, rate/pitch, and optional voice name from cadence profile when set. */
  private getVoiceOptionsForTts(): VoiceOptions {
    const base: VoiceOptions = { sampleRateHz: 48000 };
    if (!this.cadenceProfileId) return base;
    const spec = getCadencePersona(this.cadenceProfileId);
    if (!spec) return base;
    const { ratePercent, pitchPercent } = spec.ssmlDefaults ?? {};
    const googleVoiceName = spec.voice?.googleVoiceName?.trim();
    return {
      ...base,
      speakingRate: ratePercent != null ? ratePercent / 100 : undefined,
      pitch: pitchPercent != null ? (pitchPercent / 100) * 4 : undefined,
      ...(googleVoiceName ? { voiceName: googleVoiceName } : {}),
    };
  }

  /** Capture barge-in stop latency (ms) and clear; call when recording turn metrics. */
  private captureBargeInLatency(): number | undefined {
    const at = this.bargeInAt;
    this.bargeInAt = undefined;
    return at !== undefined ? Date.now() - at : undefined;
  }

  /**
   * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
   * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
   */
  async pushAudio(chunk: Buffer): Promise<void> {
    if (this.processing) return;
    this.audioBuffer.push(chunk);

    // If we already have an active streaming session for the current utterance,
    // push the new chunk immediately (chunk boundaries are preserved).
    if (!this.speaking && this.activeStreamingSession) {
      try {
        this.activeStreamingSession.push(chunk);
      } catch (err) {
        logger.warn({ event: "ASR_STREAM_PUSH_FAILED", err: (err as Error).message }, "Streaming ASR push failed; will fall back to batch at end-of-turn");
        this.activeStreamingSession = null;
      }
    }

    const combined = Buffer.concat(this.audioBuffer);
    const frameSize = VAD.getFrameSizeBytes();
    let offset = 0;
    while (offset + frameSize <= combined.length) {
      const frame = combined.subarray(offset, offset + frameSize);
      const result = this.vad.processFrame(frame);
      offset += frameSize;
      if (result.isSpeech && !this.vadSpeechLogged) {
        this.vadSpeechLogged = true;
        logger.debug({ event: "VAD_SPEECH_STARTED" }, "VAD: first speech in run (audio level above threshold)");

        // Start a streaming session on first detected speech if the adapter supports it.
        // Do not start streaming while speaking; queued/barge-in segments remain batch-only in MVP.
        if (!this.speaking && !this.activeStreamingSession && typeof this.asr.createStreamingSession === "function") {
          try {
            const opts: { sampleRateHz: number; onTurnEvent?: (event: import("../adapters/asr/types").TurnEvent) => void } = {
              sampleRateHz: VAD.getSampleRate(),
            };
            opts.onTurnEvent = (event) => {
              if (event === "end_of_turn_predicted" && this.activeStreamingSession && !this.processing && !this.speaking) {
                this.turnHandledByAsrEvent = true;
                const session = this.activeStreamingSession;
                this.activeStreamingSession = null;
                void this.finalizeStreamingSessionAndTurn(session);
              }
            };
            this.activeStreamingSession = this.asr.createStreamingSession(opts);
            // Push all buffered audio so far so the beginning of speech is included.
            this.activeStreamingSession.push(combined);
            logger.info({ event: "ASR_STREAM_SESSION_STARTED" }, "Streaming ASR session started");
          } catch (err) {
            logger.warn({ event: "ASR_STREAM_SESSION_START_FAILED", err: (err as Error).message }, "Failed to start streaming ASR session; will use batch ASR");
            this.activeStreamingSession = null;
          }
        }
      }
      // Barge-in: if user speech is detected while bot is speaking, cancel TTS immediately.
      if (this.speaking && result.isSpeech && !this.cancelTts) {
        this.cancelTts = true;
        this.bargeInAt = Date.now();
        this.callbacks.onBargeIn?.({ reason: "user_speech" });
      }
      if (result.endOfTurn && result.segment && result.segment.length > 0) {
        if (this.turnHandledByAsrEvent) {
          this.turnHandledByAsrEvent = false;
          this.vadSpeechLogged = false;
          this.audioBuffer = combined.length > offset ? [combined.subarray(offset)] : [];
          return;
        }
        this.vadSpeechLogged = false;
        this.audioBuffer = combined.length > offset ? [combined.subarray(offset)] : [];
        const segmentMs = Math.round((result.segment.length / frameSize) * 20);
        logger.info(
          { event: "VAD_END_OF_TURN", segmentBytes: result.segment.length, segmentMs, speaking: this.speaking },
          "VAD: end of turn detected (pause after speech); will run ASR or queue"
        );
        if (this.speaking) {
          // Queue the user's segment to respond after we finish (or cancel) the current utterance.
          this.pendingSegment = result.segment;
          return;
        }
        // Prefer streaming ASR finalization if we have a session; otherwise, use batch ASR on the segment.
        if (this.activeStreamingSession) {
          const session = this.activeStreamingSession;
          this.activeStreamingSession = null;
          const asrStart = Date.now();
          try {
            const transcriptResult = await withTimeout(session.end(), this.timeouts.asrMs, "ASR(stream)");
            const asrLatencyMs = Date.now() - asrStart;
            await this.startTurnFromTranscript(transcriptResult, asrLatencyMs);
            return;
          } catch (err) {
            logger.warn({ event: "ASR_STREAM_END_FAILED", err: (err as Error).message }, "Streaming ASR failed at end(); falling back to batch ASR");
            // Fall through to batch.
          }
        }
        await this.startTurn(result.segment);
        return;
      }
    }
    this.audioBuffer = offset > 0 ? [combined.subarray(offset)] : [combined];
  }

  /** Finalize streaming ASR session and run turn (called when adapter emits end_of_turn_predicted). */
  private async finalizeStreamingSessionAndTurn(
    session: ReturnType<NonNullable<IASR["createStreamingSession"]>>
  ): Promise<void> {
    if (this.processing) return;
    const asrStart = Date.now();
    try {
      const transcriptResult = await withTimeout(session.end(), this.timeouts.asrMs, "ASR(stream)");
      const asrLatencyMs = Date.now() - asrStart;
      await this.startTurnFromTranscript(transcriptResult, asrLatencyMs);
    } catch (err) {
      logger.warn({ event: "ASR_STREAM_END_FAILED", err: (err as Error).message }, "Streaming ASR turn event finalize failed");
    }
  }

  private async startTurn(segment: Buffer): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.runTurn(segment);
    } finally {
      this.processing = false;
    }
    await this.maybeRunPendingTurn();
  }

  private async startTurnFromTranscript(transcriptResult: { text: string; language?: string; words?: Array<{ word: string; start: number; end: number }> }, asrLatencyMs: number): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart: Date.now() });
    } finally {
      this.processing = false;
    }
    await this.maybeRunPendingTurn();
  }

  private async maybeRunPendingTurn(): Promise<void> {
    // If a user segment arrived while we were speaking, process it now.
    while (!this.processing && !this.speaking && this.pendingSegment && this.pendingSegment.length > 0) {
      const seg = this.pendingSegment;
      this.pendingSegment = null;
      await this.startTurn(seg);
    }
  }

  private async runTurn(audioSegment: Buffer): Promise<void> {
    if (this.backendMode === "personaplex") {
      await this.runTurnPersonaPlex(audioSegment);
      return;
    }

    const turnStart = Date.now();
    const wavBuffer = pcmToWav(audioSegment, VAD.getSampleRate());
    const asrStart = Date.now();
    let transcriptResult: { text: string; language?: string; words?: Array<{ word: string; start: number; end: number }> };
    try {
      transcriptResult = await withTimeout(this.asr.transcribe(wavBuffer, "wav"), this.timeouts.asrMs, "ASR");
    } catch (err) {
      logger.warn({ event: "ASR_FAILED", err: (err as Error).message }, "ASR failed");
      return;
    }
    const asrLatencyMs = Date.now() - asrStart;
    await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart });
  }

  private async runTurnPersonaPlex(audioSegment: Buffer): Promise<void> {
    if (!this.personaplexClient) {
      logger.error({ event: "PERSONAPLEX_MISSING_CLIENT" }, "Conversation backend is 'personaplex' but no PersonaPlex client was provided.");
      return;
    }

    const turnStart = Date.now();

    // We still run ASR to maintain memory/coordinator behavior and to build a richer prompt.
    const wavBuffer = pcmToWav(audioSegment, VAD.getSampleRate());
    const asrStart = Date.now();
    let transcriptResult: { text: string; language?: string; words?: Array<{ word: string; start: number; end: number }> };
    try {
      transcriptResult = await withTimeout(this.asr.transcribe(wavBuffer, "wav"), this.timeouts.asrMs, "ASR");
    } catch (err) {
      logger.warn({ event: "ASR_FAILED", err: (err as Error).message }, "ASR failed (PersonaPlex mode)");
      transcriptResult = { text: "" };
    }
    const asrLatencyMs = Date.now() - asrStart;

    const userTextRaw = (transcriptResult.text || "").trim();
    const userSafe = this.safety.sanitizeUserTranscript(userTextRaw);
    if (!userSafe.allowed) return;
    if (userSafe.text.length > 0) {
      this.callbacks.onUserTranscript?.(userSafe.text);
    }

    let coordinatorTurnId: string | undefined;
    if (this.coordinatorClient && userSafe.text.length > 0) {
      const turns = await this.coordinatorClient.syncRecentTurns();
      const flatTurns: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const t of turns) {
        flatTurns.push({ role: "user", content: t.user });
        flatTurns.push({ role: "assistant", content: t.assistant });
      }
      if (typeof this.memory.replaceTurns === "function") {
        this.memory.replaceTurns(flatTurns);
      }
      const stubBid = { score: 5, intent: "answer", confidence: 0.5, target: null as string | null };
      const turnResult = await this.coordinatorClient.requestTurn(userSafe.text, stubBid);
      if (!turnResult.allowed) return;
      coordinatorTurnId = turnResult.turnId;
    }

    if (userSafe.text.length > 0) {
      this.memory.append("user", userSafe.text);
    }
    const snapshot = this.memory.getSnapshot();
    const feedbackSentiment = this.getFeedbackSentiment();
    const feedbackBehaviorLevel = this.getFeedbackBehaviorLevel();

    const textPrompt = this.promptManager.buildPersonaPlexTextPrompt({
      mode: "reply",
      snapshot,
      sentiment: feedbackSentiment,
      behaviorLevel: feedbackBehaviorLevel,
    });

    // Allow receiving audio while speaking so barge-in can be detected.
    this.processing = false;
    this.speaking = true;
    this.cancelTts = false;

    const utteranceId = `personaplex-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let firstAudioAt: number | undefined;
    let started = false;

    const ppStart = Date.now();
    let turn: Awaited<ReturnType<PersonaPlexClient["runTurn"]>> | undefined;
    let ppAssistantMessage = "";
    try {
      turn = await this.personaplexClient.runTurn({ turnId: utteranceId, userPcm16k: audioSegment, textPrompt });
      for await (const buf of turn.audio48k) {
        if (this.cancelTts) {
          // Barge-in: abort remote generation quickly.
          turn.abort();
          break;
        }
        if (buf.length === 0) continue;
        if (!started) {
          started = true;
          firstAudioAt = Date.now();
          this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: 0 });
        }
        this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
      }
      if (started) this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });

      // Best-effort: capture the text token stream and store it as the assistant turn.
      let assistantText = "";
      try {
        assistantText = (await turn.text).trim();
      } catch (err) {
        logger.warn({ event: "PERSONAPLEX_TEXT_FAILED", err: (err as Error).message }, "PersonaPlex text stream failed");
      }

      const assistantSafe = this.safety.sanitizeAssistantReply(assistantText);
      if (assistantSafe.allowed && assistantSafe.text.trim().length > 0) {
        ppAssistantMessage = assistantSafe.text;
        this.memory.append("assistant", assistantSafe.text);
        this.callbacks.onAgentReply?.(assistantSafe.text);
        this.maybeScheduleRunningSummary();
      }
    } catch (err) {
      // Absorb turn.text rejection so it does not become an unhandled rejection and crash the process.
      if (turn !== undefined) turn.text.catch(() => {});
      const e = err as any;
      const failureType = typeof e?.code === "string" ? String(e.code) : undefined;
      logger.warn({ event: "PERSONAPLEX_FAILED", err: (err as Error).message, failureType }, "PersonaPlex turn failed");
      if (this.personaplexFallbackToLlm) {
        logger.info({ event: "PERSONAPLEX_FALLBACK_TO_LLM" }, "Falling back to ASR+LLM+TTS for this turn");
        // Release the coordinator turn so runTurnCore's requestTurn can succeed (we were granted the turn
        // but never called endTurn because PersonaPlex threw; without this, coordinator would return allowed: false).
        if (this.coordinatorClient && userSafe.text.length > 0) {
          await this.coordinatorClient.endTurn(userSafe.text, "", coordinatorTurnId).catch(() => {});
        }
        // If we have a usable transcript, fall back to the standard path without re-transcribing.
        await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart });
        return;
      }
    } finally {
      this.speaking = false;
      if (this.coordinatorClient && userSafe.text.length > 0 && coordinatorTurnId !== undefined) {
        await this.coordinatorClient.endTurn(userSafe.text, ppAssistantMessage, coordinatorTurnId).catch(() => {});
      }
    }

    const personaplexLatencyMs = Date.now() - ppStart;
    const endOfUserSpeechToBotAudioMs = firstAudioAt !== undefined ? firstAudioAt - turnStart : undefined;
    recordTurnMetrics({
      asrLatencyMs,
      llmLatencyMs: firstAudioAt !== undefined ? firstAudioAt - ppStart : personaplexLatencyMs,
      ttsLatencyMs: personaplexLatencyMs,
      endOfUserSpeechToBotAudioMs,
      bargeInStopLatencyMs: this.captureBargeInLatency(),
      turnId: coordinatorTurnId,
      personaId: this.personaId,
      feedbackLevel: this.getFeedbackBehaviorLevel(),
      responseTokens: ppAssistantMessage.length > 0 ? Math.ceil(ppAssistantMessage.length / 4) : undefined,
    });

    await this.maybeRunPendingTurn();
  }

  private async runTurnCore(args: {
    transcriptResult: { text: string; language?: string; words?: Array<{ word: string; start: number; end: number }> };
    asrLatencyMs: number;
    turnStart: number;
  }): Promise<void> {
    const { transcriptResult, asrLatencyMs, turnStart } = args;
    const userTextRaw = (transcriptResult.text || "").trim();
    const userSafe = this.safety.sanitizeUserTranscript(userTextRaw);
    if (!userSafe.allowed || userSafe.text.length === 0) return;
    this.callbacks.onUserTranscript?.(userSafe.text);

    let coordinatorTurnId: string | undefined;
    let winnerSelectionReason: string | undefined;
    if (this.coordinatorClient) {
      const turns = await this.coordinatorClient.syncRecentTurns();
      const flatTurns: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const t of turns) {
        flatTurns.push({ role: "user", content: t.user });
        flatTurns.push({ role: "assistant", content: t.assistant });
      }
      if (typeof this.memory.replaceTurns === "function") {
        this.memory.replaceTurns(flatTurns);
      }
      const stubBid = { score: 5, intent: "answer", confidence: 0.5, target: null as string | null };
      const turnResult = await this.coordinatorClient.requestTurn(userSafe.text, stubBid);
      if (!turnResult.allowed) return;
      coordinatorTurnId = turnResult.turnId;
      winnerSelectionReason = turnResult.winnerSelectionReason;
    }

    let assistantMessageForCoordinator = "";
    try {
    this.memory.append("user", userSafe.text);
    const snapshot = this.memory.getSnapshot();
    const feedbackSentiment = this.getFeedbackSentiment();
    const feedbackBehaviorLevel = this.getFeedbackBehaviorLevel();
    const messages: Message[] = this.promptManager.buildMessages({
      mode: "reply",
      snapshot,
      sentiment: feedbackSentiment,
      behaviorLevel: feedbackBehaviorLevel,
    });

    this.fillerAbort = false;
    const fillerChoice = this.fillerConfig ? chooseFiller(this.fillerConfig, this.personaId) : null;
    if (fillerChoice?.type === "clip") {
      const fillerId = `filler-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      void (async () => {
        try {
          this.callbacks.onTtsStart?.({ utteranceId: fillerId, source: "filler", textLength: 0 });
          for await (const buf of streamFillerClip(fillerChoice.path, 4096, () => this.fillerAbort)) {
            if (this.fillerAbort) break;
            if (buf.length > 0) this.callbacks.onTtsAudio?.(buf, { utteranceId: fillerId, source: "filler" });
          }
          this.callbacks.onTtsEnd?.({ utteranceId: fillerId, source: "filler" });
        } catch (err) {
          logger.warn({ event: "FILLER_PLAYBACK_FAILED", err: (err as Error).message }, "Filler playback failed");
        }
      })();
    }

    const llmStart = Date.now();
    let fullText = "";
    let llmLatencyMs = 0;
    try {
      const maxTokens = getReplyMaxTokens(feedbackBehaviorLevel);
      const llmResponse = await withTimeout(this.llm.chat(messages, { stream: true, maxTokens }), this.timeouts.llmMs, "LLM");
      fullText = llmResponse.text;
      const stream = llmResponse.stream;
      // Allow barge-in during LLM consumption and TTS; first audio can start as soon as first sentence is ready.
      this.processing = false;
      this.speaking = true;
      this.cancelTts = false;

      const ttsStart = Date.now();
      let firstTtsChunkAt: number | undefined;
      let ttsStarted = false;
      const utteranceId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      if (stream) {
        let buffer = "";
        try {
          for await (const token of stream) {
            if (this.cancelTts) break;
            buffer += token;
            const { sentences, remainder } = flushSentences(buffer, DEFAULT_MAX_CHARS_PER_CHUNK);
            buffer = remainder;
            for (const s of sentences) {
              if (this.cancelTts) break;
              fullText += s;
              const sentenceSafe = this.safety.sanitizeAssistantReply(s);
              if (!sentenceSafe.allowed || !sentenceSafe.text.trim()) continue;
              const ttsResult = this.tts.synthesize(sentenceSafe.text.trim(), this.getVoiceOptionsForTts());
              for await (const buf of ttsToStream(ttsResult)) {
                if (this.cancelTts) break;
                if (buf.length > 0) {
                  if (firstTtsChunkAt === undefined) firstTtsChunkAt = Date.now();
                  if (!ttsStarted) {
                    ttsStarted = true;
                    this.fillerAbort = true;
                    this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: sentenceSafe.text.trim().length });
                  }
                  this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
                }
              }
            }
          }
          if (this.cancelTts) {
            llmLatencyMs = Date.now() - llmStart;
            this.speaking = false;
            recordTurnMetrics({
              asrLatencyMs,
              llmLatencyMs,
              endOfUserSpeechToBotAudioMs: firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined,
              bargeInStopLatencyMs: this.captureBargeInLatency(),
              turnId: coordinatorTurnId,
              winnerSelectionReason: winnerSelectionReason as "name_addressing" | "round_robin" | "auction" | undefined,
              personaId: this.personaId,
              feedbackLevel: this.getFeedbackBehaviorLevel(),
              responseTokens: fullText.length > 0 ? Math.ceil(fullText.length / 4) : undefined,
            });
            await this.maybeRunPendingTurn();
            return;
          }
          /* fall through to normal completion; finally will call endTurn */
          buffer = buffer.trim();
          if (buffer.length > 0) {
            const sentenceSafe = this.safety.sanitizeAssistantReply(buffer);
            if (sentenceSafe.allowed && sentenceSafe.text.trim()) {
              fullText += buffer;
              const ttsResult = this.tts.synthesize(sentenceSafe.text.trim(), this.getVoiceOptionsForTts());
              for await (const buf of ttsToStream(ttsResult)) {
                if (this.cancelTts) break;
                if (buf.length > 0) {
                  if (firstTtsChunkAt === undefined) firstTtsChunkAt = Date.now();
                  if (!ttsStarted) {
                    ttsStarted = true;
                    this.fillerAbort = true;
                    this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: sentenceSafe.text.trim().length });
                  }
                  this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
                }
              }
            } else {
              fullText += buffer;
            }
          }
        } catch (err) {
          logger.warn({ event: "TTS_FAILED", err: (err as Error).message }, "TTS failed");
        } finally {
          if (ttsStarted) this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });
          this.speaking = false;
        }
        llmLatencyMs = Date.now() - llmStart;
        const ttsLatencyMs = Date.now() - ttsStart;
        const assistantSafe = this.safety.sanitizeAssistantReply(fullText);
        if (!assistantSafe.allowed || !assistantSafe.text.trim()) {
          recordTurnMetrics({
            asrLatencyMs,
            llmLatencyMs,
            ttsLatencyMs,
            endOfUserSpeechToBotAudioMs: firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined,
            bargeInStopLatencyMs: this.captureBargeInLatency(),
            turnId: coordinatorTurnId,
            winnerSelectionReason: winnerSelectionReason as "name_addressing" | "round_robin" | "auction" | undefined,
            personaId: this.personaId,
            feedbackLevel: this.getFeedbackBehaviorLevel(),
          });
          await this.maybeRunPendingTurn();
          return;
        }
        assistantMessageForCoordinator = assistantSafe.text;
        this.memory.append("assistant", assistantSafe.text);
        this.callbacks.onAgentReply?.(assistantSafe.text);
        this.maybeScheduleRunningSummary();
        const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
        recordTurnMetrics({
          asrLatencyMs,
          llmLatencyMs,
          ttsLatencyMs,
          endOfUserSpeechToBotAudioMs,
          bargeInStopLatencyMs: this.captureBargeInLatency(),
          turnId: coordinatorTurnId,
          winnerSelectionReason: winnerSelectionReason as "name_addressing" | "round_robin" | "auction" | undefined,
          personaId: this.personaId,
          feedbackLevel: this.getFeedbackBehaviorLevel(),
          responseTokens: assistantSafe.text.length > 0 ? Math.ceil(assistantSafe.text.length / 4) : undefined,
        });
        await this.maybeRunPendingTurn();
        return;
      }
    } catch (err) {
      logger.warn({ event: "LLM_FAILED", err: (err as Error).message }, "LLM failed");
      fullText = "Sorry—I'm having trouble responding right now. Please try again in a moment.";
    }
    llmLatencyMs = Date.now() - llmStart;
    const assistantSafe = this.safety.sanitizeAssistantReply(fullText);
    if (!assistantSafe.allowed || !assistantSafe.text.trim()) return;
    assistantMessageForCoordinator = assistantSafe.text;
    this.memory.append("assistant", assistantSafe.text);
    this.callbacks.onAgentReply?.(assistantSafe.text);
    this.maybeScheduleRunningSummary();
    this.processing = false;
    this.speaking = true;
    this.cancelTts = false;
    const ttsStart = Date.now();
    let firstTtsChunkAt: number | undefined;
    let ttsStarted = false;
    const utteranceId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const turnMetricsPayload = {
      personaId: this.personaId,
      feedbackLevel: this.getFeedbackBehaviorLevel(),
      responseTokens: assistantSafe.text.length > 0 ? Math.ceil(assistantSafe.text.length / 4) : undefined,
    };
    try {
      const ttsResult = this.tts.synthesize(assistantSafe.text.trim(), this.getVoiceOptionsForTts());
      for await (const buf of ttsToStream(ttsResult)) {
        if (this.cancelTts) break;
        if (buf.length > 0) {
          if (firstTtsChunkAt === undefined) firstTtsChunkAt = Date.now();
          if (!ttsStarted) {
            ttsStarted = true;
            this.fillerAbort = true;
            this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: assistantSafe.text.trim().length });
          }
          this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
        }
      }
    } catch (err) {
      logger.warn({ event: "TTS_FAILED", err: (err as Error).message }, "TTS failed");
    } finally {
      if (ttsStarted) this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });
      this.speaking = false;
    }
    const ttsLatencyMs = Date.now() - ttsStart;
    const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
    recordTurnMetrics({
      asrLatencyMs,
      llmLatencyMs,
      ttsLatencyMs,
      endOfUserSpeechToBotAudioMs,
      bargeInStopLatencyMs: this.captureBargeInLatency(),
      turnId: coordinatorTurnId,
      winnerSelectionReason: winnerSelectionReason as "name_addressing" | "round_robin" | "auction" | undefined,
      ...turnMetricsPayload,
    });
    await this.maybeRunPendingTurn();
    } finally {
      if (this.coordinatorClient && coordinatorTurnId !== undefined) {
        await this.coordinatorClient.endTurn(userSafe.text, assistantMessageForCoordinator, coordinatorTurnId).catch(() => {});
      }
    }
  }

  /**
   * Generate and speak a storyteller-style opener using the LLM (no user input required).
   * This is intended to run once after join (or on-demand).
   */
  async speakOpener(args: { topicSeed?: string; outpostContext?: string; maxTokens?: number }): Promise<void> {
    const snapshot = this.memory.getSnapshot();
    const feedbackSentiment = this.getFeedbackSentiment();
    const feedbackBehaviorLevel = this.getFeedbackBehaviorLevel();
    const messages: Message[] = this.promptManager.buildMessages({
      mode: "opener",
      snapshot,
      sentiment: feedbackSentiment,
      behaviorLevel: feedbackBehaviorLevel,
      topicSeed: args.topicSeed,
      outpostContext: args.outpostContext,
    });
    let fullText = "";
    try {
      const llmResponse = await withTimeout(this.llm.chat(messages, { stream: true, maxTokens: args.maxTokens ?? 180 }), this.timeouts.llmMs, "LLM(opener)");
      fullText = llmResponse.text;
      const stream = llmResponse.stream;
      if (stream) {
        const parts: string[] = [];
        for await (const token of stream) parts.push(token);
        fullText = parts.join("");
      }
    } catch (err) {
      logger.warn({ event: "OPENER_LLM_FAILED", err: (err as Error).message }, "Opener LLM failed");
      return;
    }
    const trimmed = (fullText || "").trim();
    if (!trimmed) return;
    const assistantSafe = this.safety.sanitizeAssistantReply(trimmed);
    if (!assistantSafe.allowed || !assistantSafe.text.trim()) return;
    this.memory.append("assistant", assistantSafe.text);
    this.callbacks.onAgentReply?.(assistantSafe.text);
    await this.speakTextViaTts(assistantSafe.text, "opener");
  }

  /**
   * Speak a message without user input (e.g. greeting when joining).
   * Pushes TTS to onTtsAudio and appends to memory so the LLM has context.
   */
  async speakProactively(text: string): Promise<void> {
    const trimmed = (text || "").trim();
    if (trimmed.length === 0) return;
    const assistantSafe = this.safety.sanitizeAssistantReply(trimmed);
    if (!assistantSafe.allowed || !assistantSafe.text.trim()) return;
    this.memory.append("assistant", assistantSafe.text);
    this.callbacks.onAgentReply?.(assistantSafe.text);
    await this.speakTextViaTts(assistantSafe.text, "proactive");
  }

  private async speakTextViaTts(text: string, source: "proactive" | "opener"): Promise<void> {
    const utteranceId = `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ttsResult = this.tts.synthesize(text, this.getVoiceOptionsForTts());
    let ttsStarted = false;
    // Allow receiving audio while speaking so barge-in can be detected.
    this.speaking = true;
    this.cancelTts = false;
    for await (const buf of ttsToStream(ttsResult)) {
      if (this.cancelTts) break;
      if (buf.length > 0) {
        if (!ttsStarted) {
          ttsStarted = true;
          this.callbacks.onTtsStart?.({ utteranceId, source, textLength: text.length });
        }
        this.callbacks.onTtsAudio?.(buf, { utteranceId, source });
      }
    }
    if (ttsStarted) this.callbacks.onTtsEnd?.({ utteranceId, source });
    this.speaking = false;
    await this.maybeRunPendingTurn();
  }

  /** Flush any buffered audio (call when stream ends). */
  flush(): void {
    this.audioBuffer = [];
  }
}
