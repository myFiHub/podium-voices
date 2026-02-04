/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */

import type { IASR } from "../adapters/asr";
import type { ILLM, Message } from "../adapters/llm";
import type { ITTS } from "../adapters/tts";
import type { ISessionMemory } from "../memory/types";
import type { PipelineCallbacks } from "./types";
import { VAD } from "./vad";
import { pcmToWav } from "./audio-utils";
import { PromptManager } from "../prompts/prompt-manager";
import { ttsToStream } from "../adapters/tts";
import { recordTurnMetrics } from "../metrics";
import { SafetyGate } from "./safety";
import { logger } from "../logging";

const DEFAULT_ASR_TIMEOUT_MS = 20_000;
const DEFAULT_LLM_TIMEOUT_MS = 25_000;

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
}

export class Orchestrator {
  private vad: VAD;
  private audioBuffer: Buffer[] = [];
  private processing = false;
  private speaking = false;
  private cancelTts = false;
  private pendingSegment: Buffer | null = null;
  /** Log VAD_SPEECH_STARTED only once per speech run (debug). */
  private vadSpeechLogged = false;
  private readonly getFeedbackSentiment: () => "cheer" | "boo" | "neutral";
  private readonly getFeedbackBehaviorLevel: () => "high_positive" | "positive" | "neutral" | "negative" | "high_negative";
  private readonly promptManager: PromptManager;
  private readonly safety: SafetyGate;
  private readonly timeouts: { asrMs: number; llmMs: number };

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
  }

  /**
   * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
   * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
   */
  async pushAudio(chunk: Buffer): Promise<void> {
    if (this.processing) return;
    this.audioBuffer.push(chunk);
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
      }
      // Barge-in: if user speech is detected while bot is speaking, cancel TTS immediately.
      if (this.speaking && result.isSpeech && !this.cancelTts) {
        this.cancelTts = true;
        this.callbacks.onBargeIn?.({ reason: "user_speech" });
      }
      if (result.endOfTurn && result.segment && result.segment.length > 0) {
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
        await this.startTurn(result.segment);
        return;
      }
    }
    this.audioBuffer = offset > 0 ? [combined.subarray(offset)] : [combined];
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

  private async maybeRunPendingTurn(): Promise<void> {
    // If a user segment arrived while we were speaking, process it now.
    while (!this.processing && !this.speaking && this.pendingSegment && this.pendingSegment.length > 0) {
      const seg = this.pendingSegment;
      this.pendingSegment = null;
      await this.startTurn(seg);
    }
  }

  private async runTurn(audioSegment: Buffer): Promise<void> {
    const turnStart = Date.now();
    const wavBuffer = pcmToWav(audioSegment, VAD.getSampleRate());
    const asrStart = Date.now();
    let transcriptResult: { text: string };
    try {
      transcriptResult = await withTimeout(this.asr.transcribe(wavBuffer, "wav"), this.timeouts.asrMs, "ASR");
    } catch (err) {
      logger.warn({ event: "ASR_FAILED", err: (err as Error).message }, "ASR failed");
      return;
    }
    const asrLatencyMs = Date.now() - asrStart;
    const userTextRaw = (transcriptResult.text || "").trim();
    const userSafe = this.safety.sanitizeUserTranscript(userTextRaw);
    if (!userSafe.allowed || userSafe.text.length === 0) return;
    this.callbacks.onUserTranscript?.(userSafe.text);

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

    const llmStart = Date.now();
    let fullText = "";
    try {
      const llmResponse = await withTimeout(this.llm.chat(messages, { stream: true, maxTokens: 150 }), this.timeouts.llmMs, "LLM");
      fullText = llmResponse.text;
      const stream = llmResponse.stream;
      if (stream) {
        const parts: string[] = [];
        for await (const token of stream) parts.push(token);
        fullText = parts.join("");
      }
    } catch (err) {
      logger.warn({ event: "LLM_FAILED", err: (err as Error).message }, "LLM failed");
      fullText = "Sorry—I'm having trouble responding right now. Please try again in a moment.";
    }
    const llmLatencyMs = Date.now() - llmStart;
    const assistantSafe = this.safety.sanitizeAssistantReply(fullText);
    if (!assistantSafe.allowed || !assistantSafe.text.trim()) return;
    this.memory.append("assistant", assistantSafe.text);
    this.callbacks.onAgentReply?.(assistantSafe.text);

    // Allow receiving audio while speaking so barge-in can be detected.
    this.processing = false;
    this.speaking = true;
    this.cancelTts = false;

    const ttsStart = Date.now();
    let firstTtsChunkAt: number | undefined;
    let ttsStarted = false;
    const utteranceId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const ttsResult = this.tts.synthesize(assistantSafe.text.trim(), { sampleRateHz: 48000 });
      for await (const buf of ttsToStream(ttsResult)) {
        if (this.cancelTts) break;
        if (buf.length > 0) {
          if (firstTtsChunkAt === undefined) firstTtsChunkAt = Date.now();
          if (!ttsStarted) {
            ttsStarted = true;
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
    });
    await this.maybeRunPendingTurn();
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
    const ttsResult = this.tts.synthesize(text, { sampleRateHz: 48000 });
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
