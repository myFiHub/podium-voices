"use strict";
/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const vad_1 = require("./vad");
const audio_utils_1 = require("./audio-utils");
const co_host_1 = require("../prompts/co-host");
const tts_1 = require("../adapters/tts");
const metrics_1 = require("../metrics");
class Orchestrator {
    asr;
    llm;
    tts;
    memory;
    config;
    callbacks;
    vad;
    audioBuffer = [];
    processing = false;
    getFeedbackSentiment;
    constructor(asr, llm, tts, memory, config, callbacks = {}) {
        this.asr = asr;
        this.llm = llm;
        this.tts = tts;
        this.memory = memory;
        this.config = config;
        this.callbacks = callbacks;
        this.vad = new vad_1.VAD({
            silenceMs: config.vadSilenceMs,
            aggressiveness: 1,
        });
        this.getFeedbackSentiment = config.getFeedbackSentiment ?? (() => "neutral");
    }
    /**
     * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
     * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
     */
    async pushAudio(chunk) {
        if (this.processing)
            return;
        this.audioBuffer.push(chunk);
        const combined = Buffer.concat(this.audioBuffer);
        const frameSize = vad_1.VAD.getFrameSizeBytes();
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
                }
                finally {
                    this.processing = false;
                }
                return;
            }
        }
        this.audioBuffer = offset > 0 ? [combined.subarray(offset)] : [combined];
    }
    async runTurn(audioSegment) {
        const turnStart = Date.now();
        const wavBuffer = (0, audio_utils_1.pcmToWav)(audioSegment, vad_1.VAD.getSampleRate());
        const asrStart = Date.now();
        const transcriptResult = await this.asr.transcribe(wavBuffer, "wav");
        const asrLatencyMs = Date.now() - asrStart;
        const userText = (transcriptResult.text || "").trim();
        if (userText.length === 0)
            return;
        this.callbacks.onUserTranscript?.(userText);
        this.memory.append("user", userText);
        const snapshot = this.memory.getSnapshot();
        const feedbackSentiment = this.getFeedbackSentiment();
        const feedbackLine = (0, co_host_1.buildFeedbackLine)(feedbackSentiment, true);
        const historyMessages = (0, co_host_1.memoryToMessages)(snapshot, feedbackLine);
        const messages = [
            { role: "system", content: co_host_1.CO_HOST_SYSTEM_PROMPT },
            ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        ];
        const llmStart = Date.now();
        const llmResponse = await this.llm.chat(messages, { stream: true, maxTokens: 150 });
        let fullText = llmResponse.text;
        const stream = llmResponse.stream;
        if (stream) {
            const parts = [];
            for await (const token of stream) {
                parts.push(token);
            }
            fullText = parts.join("");
        }
        const llmLatencyMs = Date.now() - llmStart;
        if (!fullText.trim())
            return;
        this.memory.append("assistant", fullText);
        this.callbacks.onAgentReply?.(fullText);
        const ttsStart = Date.now();
        let firstTtsChunkAt;
        const ttsResult = this.tts.synthesize(fullText.trim(), { sampleRateHz: 48000 });
        for await (const buf of (0, tts_1.ttsToStream)(ttsResult)) {
            if (buf.length > 0) {
                if (firstTtsChunkAt === undefined)
                    firstTtsChunkAt = Date.now();
                this.callbacks.onTtsAudio?.(buf);
            }
        }
        const ttsLatencyMs = Date.now() - ttsStart;
        const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
        (0, metrics_1.recordTurnMetrics)({
            asrLatencyMs,
            llmLatencyMs,
            ttsLatencyMs,
            endOfUserSpeechToBotAudioMs,
        });
    }
    /** Flush any buffered audio (call when stream ends). */
    flush() {
        this.audioBuffer = [];
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map