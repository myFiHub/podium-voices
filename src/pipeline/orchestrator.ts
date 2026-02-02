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
import { CO_HOST_SYSTEM_PROMPT, buildFeedbackLine, memoryToMessages } from "../prompts/co-host";
import { ttsToStream } from "../adapters/tts";
import { recordTurnMetrics } from "../metrics";

export interface OrchestratorConfig {
  vadSilenceMs: number;
  /** Feedback sentiment for this turn (cheer | boo | neutral). */
  getFeedbackSentiment?: () => "cheer" | "boo" | "neutral";
}

export class Orchestrator {
  private vad: VAD;
  private audioBuffer: Buffer[] = [];
  private processing = false;
  private readonly getFeedbackSentiment: () => "cheer" | "boo" | "neutral";

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
      aggressiveness: 1,
    });
    this.getFeedbackSentiment = config.getFeedbackSentiment ?? (() => "neutral");
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
      if (result.endOfTurn && result.segment && result.segment.length > 0) {
        this.audioBuffer = combined.length > offset ? [combined.subarray(offset)] : [];
        this.processing = true;
        try {
          await this.runTurn(result.segment);
        } finally {
          this.processing = false;
        }
        return;
      }
    }
    this.audioBuffer = offset > 0 ? [combined.subarray(offset)] : [combined];
  }

  private async runTurn(audioSegment: Buffer): Promise<void> {
    const turnStart = Date.now();
    const wavBuffer = pcmToWav(audioSegment, VAD.getSampleRate());
    const asrStart = Date.now();
    const transcriptResult = await this.asr.transcribe(wavBuffer, "wav");
    const asrLatencyMs = Date.now() - asrStart;
    const userText = (transcriptResult.text || "").trim();
    if (userText.length === 0) return;
    this.callbacks.onUserTranscript?.(userText);

    this.memory.append("user", userText);
    const snapshot = this.memory.getSnapshot();
    const feedbackSentiment = this.getFeedbackSentiment();
    const feedbackLine = buildFeedbackLine(feedbackSentiment, true);
    const historyMessages = memoryToMessages(snapshot, feedbackLine);
    const messages: Message[] = [
      { role: "system", content: CO_HOST_SYSTEM_PROMPT },
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const llmStart = Date.now();
    const llmResponse = await this.llm.chat(messages, { stream: true, maxTokens: 150 });
    let fullText = llmResponse.text;
    const stream = llmResponse.stream;
    if (stream) {
      const parts: string[] = [];
      for await (const token of stream) {
        parts.push(token);
      }
      fullText = parts.join("");
    }
    const llmLatencyMs = Date.now() - llmStart;
    if (!fullText.trim()) return;
    this.memory.append("assistant", fullText);
    this.callbacks.onAgentReply?.(fullText);

    const ttsStart = Date.now();
    let firstTtsChunkAt: number | undefined;
    const ttsResult = this.tts.synthesize(fullText.trim(), { sampleRateHz: 48000 });
    for await (const buf of ttsToStream(ttsResult)) {
      if (buf.length > 0) {
        if (firstTtsChunkAt === undefined) firstTtsChunkAt = Date.now();
        this.callbacks.onTtsAudio?.(buf);
      }
    }
    const ttsLatencyMs = Date.now() - ttsStart;
    const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
    recordTurnMetrics({
      asrLatencyMs,
      llmLatencyMs,
      ttsLatencyMs,
      endOfUserSpeechToBotAudioMs,
    });
  }

  /**
   * Speak a message without user input (e.g. greeting when joining).
   * Pushes TTS to onTtsAudio and appends to memory so the LLM has context.
   */
  async speakProactively(text: string): Promise<void> {
    const trimmed = (text || "").trim();
    if (trimmed.length === 0) return;
    this.memory.append("assistant", trimmed);
    this.callbacks.onAgentReply?.(trimmed);
    const ttsResult = this.tts.synthesize(trimmed, { sampleRateHz: 48000 });
    for await (const buf of ttsToStream(ttsResult)) {
      if (buf.length > 0) this.callbacks.onTtsAudio?.(buf);
    }
  }

  /** Flush any buffered audio (call when stream ends). */
  flush(): void {
    this.audioBuffer = [];
  }
}
