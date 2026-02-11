"use strict";
/**
 * Orchestrator: coordinates VAD -> ASR -> memory -> LLM -> TTS.
 * Consumes audio chunks, detects end-of-turn, runs pipeline, outputs TTS audio via callback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const vad_1 = require("./vad");
const audio_utils_1 = require("./audio-utils");
const prompt_manager_1 = require("../prompts/prompt-manager");
const tts_1 = require("../adapters/tts");
const metrics_1 = require("../metrics");
const safety_1 = require("./safety");
const logging_1 = require("../logging");
const sentence_splitter_1 = require("./sentence-splitter");
const DEFAULT_ASR_TIMEOUT_MS = 20_000;
const DEFAULT_LLM_TIMEOUT_MS = 25_000;
function withTimeout(p, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
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
    speaking = false;
    cancelTts = false;
    pendingSegment = null;
    activeStreamingSession = null;
    /** Log VAD_SPEECH_STARTED only once per speech run (debug). */
    vadSpeechLogged = false;
    getFeedbackSentiment;
    getFeedbackBehaviorLevel;
    promptManager;
    safety;
    timeouts;
    coordinatorClient;
    backendMode;
    personaplexClient;
    personaplexFallbackToLlm;
    constructor(asr, llm, tts, memory, config, callbacks = {}) {
        this.asr = asr;
        this.llm = llm;
        this.tts = tts;
        this.memory = memory;
        this.config = config;
        this.callbacks = callbacks;
        this.vad = new vad_1.VAD({
            silenceMs: config.vadSilenceMs,
            aggressiveness: config.vadAggressiveness ?? 1,
            energyThreshold: config.vadEnergyThreshold,
        });
        this.getFeedbackSentiment = config.getFeedbackSentiment ?? (() => "neutral");
        this.getFeedbackBehaviorLevel = config.getFeedbackBehaviorLevel ?? (() => "neutral");
        this.promptManager = config.promptManager ?? new prompt_manager_1.PromptManager();
        this.safety = config.safetyGate ?? new safety_1.SafetyGate();
        this.timeouts = {
            asrMs: config.timeouts?.asrMs ?? DEFAULT_ASR_TIMEOUT_MS,
            llmMs: config.timeouts?.llmMs ?? DEFAULT_LLM_TIMEOUT_MS,
        };
        this.coordinatorClient = config.coordinatorClient;
        this.backendMode = config.conversationBackendMode ?? "asr-llm-tts";
        this.personaplexClient = config.personaplexClient;
        this.personaplexFallbackToLlm = Boolean(config.personaplexFallbackToLlm);
    }
    /**
     * Push raw audio (16kHz mono 16-bit PCM for VAD). Call repeatedly with chunks.
     * When end-of-turn is detected, runs ASR -> memory -> LLM -> TTS and invokes onTtsAudio.
     */
    async pushAudio(chunk) {
        if (this.processing)
            return;
        this.audioBuffer.push(chunk);
        // If we already have an active streaming session for the current utterance,
        // push the new chunk immediately (chunk boundaries are preserved).
        if (!this.speaking && this.activeStreamingSession) {
            try {
                this.activeStreamingSession.push(chunk);
            }
            catch (err) {
                logging_1.logger.warn({ event: "ASR_STREAM_PUSH_FAILED", err: err.message }, "Streaming ASR push failed; will fall back to batch at end-of-turn");
                this.activeStreamingSession = null;
            }
        }
        const combined = Buffer.concat(this.audioBuffer);
        const frameSize = vad_1.VAD.getFrameSizeBytes();
        let offset = 0;
        while (offset + frameSize <= combined.length) {
            const frame = combined.subarray(offset, offset + frameSize);
            const result = this.vad.processFrame(frame);
            offset += frameSize;
            if (result.isSpeech && !this.vadSpeechLogged) {
                this.vadSpeechLogged = true;
                logging_1.logger.debug({ event: "VAD_SPEECH_STARTED" }, "VAD: first speech in run (audio level above threshold)");
                // Start a streaming session on first detected speech if the adapter supports it.
                // Do not start streaming while speaking; queued/barge-in segments remain batch-only in MVP.
                if (!this.speaking && !this.activeStreamingSession && typeof this.asr.createStreamingSession === "function") {
                    try {
                        this.activeStreamingSession = this.asr.createStreamingSession({ sampleRateHz: vad_1.VAD.getSampleRate() });
                        // Push all buffered audio so far so the beginning of speech is included.
                        // This may include some leading silence, which is acceptable for MVP.
                        this.activeStreamingSession.push(combined);
                        logging_1.logger.info({ event: "ASR_STREAM_SESSION_STARTED" }, "Streaming ASR session started");
                    }
                    catch (err) {
                        logging_1.logger.warn({ event: "ASR_STREAM_SESSION_START_FAILED", err: err.message }, "Failed to start streaming ASR session; will use batch ASR");
                        this.activeStreamingSession = null;
                    }
                }
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
                logging_1.logger.info({ event: "VAD_END_OF_TURN", segmentBytes: result.segment.length, segmentMs, speaking: this.speaking }, "VAD: end of turn detected (pause after speech); will run ASR or queue");
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
                    }
                    catch (err) {
                        logging_1.logger.warn({ event: "ASR_STREAM_END_FAILED", err: err.message }, "Streaming ASR failed at end(); falling back to batch ASR");
                        // Fall through to batch.
                    }
                }
                await this.startTurn(result.segment);
                return;
            }
        }
        this.audioBuffer = offset > 0 ? [combined.subarray(offset)] : [combined];
    }
    async startTurn(segment) {
        if (this.processing)
            return;
        this.processing = true;
        try {
            await this.runTurn(segment);
        }
        finally {
            this.processing = false;
        }
        await this.maybeRunPendingTurn();
    }
    async startTurnFromTranscript(transcriptResult, asrLatencyMs) {
        if (this.processing)
            return;
        this.processing = true;
        try {
            await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart: Date.now() });
        }
        finally {
            this.processing = false;
        }
        await this.maybeRunPendingTurn();
    }
    async maybeRunPendingTurn() {
        // If a user segment arrived while we were speaking, process it now.
        while (!this.processing && !this.speaking && this.pendingSegment && this.pendingSegment.length > 0) {
            const seg = this.pendingSegment;
            this.pendingSegment = null;
            await this.startTurn(seg);
        }
    }
    async runTurn(audioSegment) {
        if (this.backendMode === "personaplex") {
            await this.runTurnPersonaPlex(audioSegment);
            return;
        }
        const turnStart = Date.now();
        const wavBuffer = (0, audio_utils_1.pcmToWav)(audioSegment, vad_1.VAD.getSampleRate());
        const asrStart = Date.now();
        let transcriptResult;
        try {
            transcriptResult = await withTimeout(this.asr.transcribe(wavBuffer, "wav"), this.timeouts.asrMs, "ASR");
        }
        catch (err) {
            logging_1.logger.warn({ event: "ASR_FAILED", err: err.message }, "ASR failed");
            return;
        }
        const asrLatencyMs = Date.now() - asrStart;
        await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart });
    }
    async runTurnPersonaPlex(audioSegment) {
        if (!this.personaplexClient) {
            logging_1.logger.error({ event: "PERSONAPLEX_MISSING_CLIENT" }, "Conversation backend is 'personaplex' but no PersonaPlex client was provided.");
            return;
        }
        const turnStart = Date.now();
        // We still run ASR to maintain memory/coordinator behavior and to build a richer prompt.
        const wavBuffer = (0, audio_utils_1.pcmToWav)(audioSegment, vad_1.VAD.getSampleRate());
        const asrStart = Date.now();
        let transcriptResult;
        try {
            transcriptResult = await withTimeout(this.asr.transcribe(wavBuffer, "wav"), this.timeouts.asrMs, "ASR");
        }
        catch (err) {
            logging_1.logger.warn({ event: "ASR_FAILED", err: err.message }, "ASR failed (PersonaPlex mode)");
            transcriptResult = { text: "" };
        }
        const asrLatencyMs = Date.now() - asrStart;
        const userTextRaw = (transcriptResult.text || "").trim();
        const userSafe = this.safety.sanitizeUserTranscript(userTextRaw);
        if (!userSafe.allowed)
            return;
        if (userSafe.text.length > 0) {
            this.callbacks.onUserTranscript?.(userSafe.text);
        }
        if (this.coordinatorClient && userSafe.text.length > 0) {
            const turns = await this.coordinatorClient.syncRecentTurns();
            const flatTurns = [];
            for (const t of turns) {
                flatTurns.push({ role: "user", content: t.user });
                flatTurns.push({ role: "assistant", content: t.assistant });
            }
            if (typeof this.memory.replaceTurns === "function") {
                this.memory.replaceTurns(flatTurns);
            }
            const allowed = await this.coordinatorClient.requestTurn(userSafe.text);
            if (!allowed)
                return;
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
        let firstAudioAt;
        let started = false;
        const ppStart = Date.now();
        let turn;
        try {
            turn = await this.personaplexClient.runTurn({ turnId: utteranceId, userPcm16k: audioSegment, textPrompt });
            for await (const buf of turn.audio48k) {
                if (this.cancelTts) {
                    // Barge-in: abort remote generation quickly.
                    turn.abort();
                    break;
                }
                if (buf.length === 0)
                    continue;
                if (!started) {
                    started = true;
                    firstAudioAt = Date.now();
                    this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: 0 });
                }
                this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
            }
            if (started)
                this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });
            // Best-effort: capture the text token stream and store it as the assistant turn.
            let assistantText = "";
            try {
                assistantText = (await turn.text).trim();
            }
            catch (err) {
                logging_1.logger.warn({ event: "PERSONAPLEX_TEXT_FAILED", err: err.message }, "PersonaPlex text stream failed");
            }
            const assistantSafe = this.safety.sanitizeAssistantReply(assistantText);
            if (assistantSafe.allowed && assistantSafe.text.trim().length > 0) {
                this.memory.append("assistant", assistantSafe.text);
                this.callbacks.onAgentReply?.(assistantSafe.text);
                if (this.coordinatorClient && userSafe.text.length > 0) {
                    await this.coordinatorClient.endTurn(userSafe.text, assistantSafe.text);
                }
            }
            else {
                // Still end coordinator turn if we were allowed to speak; use empty assistant.
                if (this.coordinatorClient && userSafe.text.length > 0) {
                    await this.coordinatorClient.endTurn(userSafe.text, "");
                }
            }
        }
        catch (err) {
            // Absorb turn.text rejection so it does not become an unhandled rejection and crash the process.
            if (turn !== undefined)
                turn.text.catch(() => { });
            const e = err;
            const failureType = typeof e?.code === "string" ? String(e.code) : undefined;
            logging_1.logger.warn({ event: "PERSONAPLEX_FAILED", err: err.message, failureType }, "PersonaPlex turn failed");
            if (this.personaplexFallbackToLlm) {
                logging_1.logger.info({ event: "PERSONAPLEX_FALLBACK_TO_LLM" }, "Falling back to ASR+LLM+TTS for this turn");
                // Release the coordinator turn so runTurnCore's requestTurn can succeed (we were granted the turn
                // but never called endTurn because PersonaPlex threw; without this, coordinator would return allowed: false).
                if (this.coordinatorClient && userSafe.text.length > 0) {
                    await this.coordinatorClient.endTurn(userSafe.text, "").catch(() => { });
                }
                // If we have a usable transcript, fall back to the standard path without re-transcribing.
                await this.runTurnCore({ transcriptResult, asrLatencyMs, turnStart });
                return;
            }
        }
        finally {
            this.speaking = false;
        }
        const personaplexLatencyMs = Date.now() - ppStart;
        const endOfUserSpeechToBotAudioMs = firstAudioAt !== undefined ? firstAudioAt - turnStart : undefined;
        (0, metrics_1.recordTurnMetrics)({
            asrLatencyMs,
            // Map PersonaPlex response time to the existing metrics fields.
            llmLatencyMs: firstAudioAt !== undefined ? firstAudioAt - ppStart : personaplexLatencyMs,
            ttsLatencyMs: personaplexLatencyMs,
            endOfUserSpeechToBotAudioMs,
        });
        await this.maybeRunPendingTurn();
    }
    async runTurnCore(args) {
        const { transcriptResult, asrLatencyMs, turnStart } = args;
        const userTextRaw = (transcriptResult.text || "").trim();
        const userSafe = this.safety.sanitizeUserTranscript(userTextRaw);
        if (!userSafe.allowed || userSafe.text.length === 0)
            return;
        this.callbacks.onUserTranscript?.(userSafe.text);
        if (this.coordinatorClient) {
            const turns = await this.coordinatorClient.syncRecentTurns();
            const flatTurns = [];
            for (const t of turns) {
                flatTurns.push({ role: "user", content: t.user });
                flatTurns.push({ role: "assistant", content: t.assistant });
            }
            if (typeof this.memory.replaceTurns === "function") {
                this.memory.replaceTurns(flatTurns);
            }
            const allowed = await this.coordinatorClient.requestTurn(userSafe.text);
            if (!allowed)
                return;
        }
        this.memory.append("user", userSafe.text);
        const snapshot = this.memory.getSnapshot();
        const feedbackSentiment = this.getFeedbackSentiment();
        const feedbackBehaviorLevel = this.getFeedbackBehaviorLevel();
        const messages = this.promptManager.buildMessages({
            mode: "reply",
            snapshot,
            sentiment: feedbackSentiment,
            behaviorLevel: feedbackBehaviorLevel,
        });
        const llmStart = Date.now();
        let fullText = "";
        let llmLatencyMs = 0;
        try {
            const llmResponse = await withTimeout(this.llm.chat(messages, { stream: true, maxTokens: 150 }), this.timeouts.llmMs, "LLM");
            fullText = llmResponse.text;
            const stream = llmResponse.stream;
            // Allow barge-in during LLM consumption and TTS; first audio can start as soon as first sentence is ready.
            this.processing = false;
            this.speaking = true;
            this.cancelTts = false;
            const ttsStart = Date.now();
            let firstTtsChunkAt;
            let ttsStarted = false;
            const utteranceId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            if (stream) {
                let buffer = "";
                try {
                    for await (const token of stream) {
                        if (this.cancelTts)
                            break;
                        buffer += token;
                        const { sentences, remainder } = (0, sentence_splitter_1.flushSentences)(buffer, sentence_splitter_1.DEFAULT_MAX_CHARS_PER_CHUNK);
                        buffer = remainder;
                        for (const s of sentences) {
                            if (this.cancelTts)
                                break;
                            fullText += s;
                            const sentenceSafe = this.safety.sanitizeAssistantReply(s);
                            if (!sentenceSafe.allowed || !sentenceSafe.text.trim())
                                continue;
                            const ttsResult = this.tts.synthesize(sentenceSafe.text.trim(), { sampleRateHz: 48000 });
                            for await (const buf of (0, tts_1.ttsToStream)(ttsResult)) {
                                if (this.cancelTts)
                                    break;
                                if (buf.length > 0) {
                                    if (firstTtsChunkAt === undefined)
                                        firstTtsChunkAt = Date.now();
                                    if (!ttsStarted) {
                                        ttsStarted = true;
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
                        (0, metrics_1.recordTurnMetrics)({ asrLatencyMs, llmLatencyMs, endOfUserSpeechToBotAudioMs: firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined });
                        await this.maybeRunPendingTurn();
                        return;
                    }
                    buffer = buffer.trim();
                    if (buffer.length > 0) {
                        const sentenceSafe = this.safety.sanitizeAssistantReply(buffer);
                        if (sentenceSafe.allowed && sentenceSafe.text.trim()) {
                            fullText += buffer;
                            const ttsResult = this.tts.synthesize(sentenceSafe.text.trim(), { sampleRateHz: 48000 });
                            for await (const buf of (0, tts_1.ttsToStream)(ttsResult)) {
                                if (this.cancelTts)
                                    break;
                                if (buf.length > 0) {
                                    if (firstTtsChunkAt === undefined)
                                        firstTtsChunkAt = Date.now();
                                    if (!ttsStarted) {
                                        ttsStarted = true;
                                        this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: sentenceSafe.text.trim().length });
                                    }
                                    this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
                                }
                            }
                        }
                        else {
                            fullText += buffer;
                        }
                    }
                }
                catch (err) {
                    logging_1.logger.warn({ event: "TTS_FAILED", err: err.message }, "TTS failed");
                }
                finally {
                    if (ttsStarted)
                        this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });
                    this.speaking = false;
                }
                llmLatencyMs = Date.now() - llmStart;
                const ttsLatencyMs = Date.now() - ttsStart;
                const assistantSafe = this.safety.sanitizeAssistantReply(fullText);
                if (!assistantSafe.allowed || !assistantSafe.text.trim()) {
                    (0, metrics_1.recordTurnMetrics)({
                        asrLatencyMs,
                        llmLatencyMs,
                        ttsLatencyMs,
                        endOfUserSpeechToBotAudioMs: firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined,
                    });
                    await this.maybeRunPendingTurn();
                    return;
                }
                this.memory.append("assistant", assistantSafe.text);
                this.callbacks.onAgentReply?.(assistantSafe.text);
                if (this.coordinatorClient) {
                    await this.coordinatorClient.endTurn(userSafe.text, assistantSafe.text);
                }
                const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
                (0, metrics_1.recordTurnMetrics)({
                    asrLatencyMs,
                    llmLatencyMs,
                    ttsLatencyMs,
                    endOfUserSpeechToBotAudioMs,
                });
                await this.maybeRunPendingTurn();
                return;
            }
        }
        catch (err) {
            logging_1.logger.warn({ event: "LLM_FAILED", err: err.message }, "LLM failed");
            fullText = "Sorry—I'm having trouble responding right now. Please try again in a moment.";
        }
        llmLatencyMs = Date.now() - llmStart;
        const assistantSafe = this.safety.sanitizeAssistantReply(fullText);
        if (!assistantSafe.allowed || !assistantSafe.text.trim())
            return;
        this.memory.append("assistant", assistantSafe.text);
        this.callbacks.onAgentReply?.(assistantSafe.text);
        if (this.coordinatorClient) {
            await this.coordinatorClient.endTurn(userSafe.text, assistantSafe.text);
        }
        this.processing = false;
        this.speaking = true;
        this.cancelTts = false;
        const ttsStart = Date.now();
        let firstTtsChunkAt;
        let ttsStarted = false;
        const utteranceId = `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            const ttsResult = this.tts.synthesize(assistantSafe.text.trim(), { sampleRateHz: 48000 });
            for await (const buf of (0, tts_1.ttsToStream)(ttsResult)) {
                if (this.cancelTts)
                    break;
                if (buf.length > 0) {
                    if (firstTtsChunkAt === undefined)
                        firstTtsChunkAt = Date.now();
                    if (!ttsStarted) {
                        ttsStarted = true;
                        this.callbacks.onTtsStart?.({ utteranceId, source: "turn", textLength: assistantSafe.text.trim().length });
                    }
                    this.callbacks.onTtsAudio?.(buf, { utteranceId, source: "turn" });
                }
            }
        }
        catch (err) {
            logging_1.logger.warn({ event: "TTS_FAILED", err: err.message }, "TTS failed");
        }
        finally {
            if (ttsStarted)
                this.callbacks.onTtsEnd?.({ utteranceId, source: "turn" });
            this.speaking = false;
        }
        const ttsLatencyMs = Date.now() - ttsStart;
        const endOfUserSpeechToBotAudioMs = firstTtsChunkAt !== undefined ? firstTtsChunkAt - turnStart : undefined;
        (0, metrics_1.recordTurnMetrics)({
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
    async speakOpener(args) {
        const snapshot = this.memory.getSnapshot();
        const feedbackSentiment = this.getFeedbackSentiment();
        const feedbackBehaviorLevel = this.getFeedbackBehaviorLevel();
        const messages = this.promptManager.buildMessages({
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
                const parts = [];
                for await (const token of stream)
                    parts.push(token);
                fullText = parts.join("");
            }
        }
        catch (err) {
            logging_1.logger.warn({ event: "OPENER_LLM_FAILED", err: err.message }, "Opener LLM failed");
            return;
        }
        const trimmed = (fullText || "").trim();
        if (!trimmed)
            return;
        const assistantSafe = this.safety.sanitizeAssistantReply(trimmed);
        if (!assistantSafe.allowed || !assistantSafe.text.trim())
            return;
        this.memory.append("assistant", assistantSafe.text);
        this.callbacks.onAgentReply?.(assistantSafe.text);
        await this.speakTextViaTts(assistantSafe.text, "opener");
    }
    /**
     * Speak a message without user input (e.g. greeting when joining).
     * Pushes TTS to onTtsAudio and appends to memory so the LLM has context.
     */
    async speakProactively(text) {
        const trimmed = (text || "").trim();
        if (trimmed.length === 0)
            return;
        const assistantSafe = this.safety.sanitizeAssistantReply(trimmed);
        if (!assistantSafe.allowed || !assistantSafe.text.trim())
            return;
        this.memory.append("assistant", assistantSafe.text);
        this.callbacks.onAgentReply?.(assistantSafe.text);
        await this.speakTextViaTts(assistantSafe.text, "proactive");
    }
    async speakTextViaTts(text, source) {
        const utteranceId = `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const ttsResult = this.tts.synthesize(text, { sampleRateHz: 48000 });
        let ttsStarted = false;
        // Allow receiving audio while speaking so barge-in can be detected.
        this.speaking = true;
        this.cancelTts = false;
        for await (const buf of (0, tts_1.ttsToStream)(ttsResult)) {
            if (this.cancelTts)
                break;
            if (buf.length > 0) {
                if (!ttsStarted) {
                    ttsStarted = true;
                    this.callbacks.onTtsStart?.({ utteranceId, source, textLength: text.length });
                }
                this.callbacks.onTtsAudio?.(buf, { utteranceId, source });
            }
        }
        if (ttsStarted)
            this.callbacks.onTtsEnd?.({ utteranceId, source });
        this.speaking = false;
        await this.maybeRunPendingTurn();
    }
    /** Flush any buffered audio (call when stream ends). */
    flush() {
        this.audioBuffer = [];
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map