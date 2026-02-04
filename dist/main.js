"use strict";
/**
 * Entry point: load config, optionally start room client + orchestrator.
 * Use mock room when PODIUM_TOKEN or PODIUM_OUTPOST_UUID are not set.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const asr_1 = require("./adapters/asr");
const llm_1 = require("./adapters/llm");
const tts_1 = require("./adapters/tts");
const session_1 = require("./memory/session");
const orchestrator_1 = require("./pipeline/orchestrator");
const collector_1 = require("./feedback/collector");
const logging_1 = require("./logging");
const metrics_1 = require("./metrics");
const mock_1 = require("./room/mock");
const client_1 = require("./room/client");
const speaking_controller_1 = require("./room/speaking-controller");
const live_state_1 = require("./room/live-state");
const prompt_manager_1 = require("./prompts/prompt-manager");
const persona_1 = require("./prompts/persona");
const client_2 = require("./coordinator/client");
async function main() {
    const config = (0, config_1.loadConfig)();
    const validation = (0, config_1.validateConfig)(config);
    for (const msg of validation.errors) {
        logging_1.logger.error({ event: "CONFIG_ERROR" }, msg);
    }
    for (const msg of validation.warnings) {
        logging_1.logger.warn({ event: "CONFIG_WARNING" }, msg);
    }
    if (validation.errors.length > 0) {
        logging_1.logger.warn({ event: "CONFIG_SUMMARY", errorCount: validation.errors.length, warningCount: validation.warnings.length }, "Configuration has errors. Fix .env.local (see .env.example) or some features will not work.");
    }
    else if (validation.warnings.length === 0) {
        logging_1.logger.info({ event: "CONFIG_OK" }, "Configuration OK: .env.local loaded and required keys set.");
    }
    const asr = (0, asr_1.createASR)(config);
    const llm = (0, llm_1.createLLM)(config);
    const tts = (0, tts_1.createTTS)(config);
    const memory = new session_1.SessionMemory({ maxTurns: config.pipeline.maxTurnsInMemory });
    const feedbackCollector = new collector_1.FeedbackCollector({ windowMs: 60_000 });
    const persona = (0, persona_1.getPersona)(config.agent.personaId);
    const promptManager = new prompt_manager_1.PromptManager({
        systemPrompt: persona.systemPrompt,
        storytellerAddendum: persona.storytellerAddendum,
        feedbackContextBuilder: persona.feedbackContextBuilder,
    });
    const coordinatorClient = config.agent.coordinatorUrl && config.agent.agentId
        ? new client_2.CoordinatorClient({
            baseUrl: config.agent.coordinatorUrl,
            agentId: config.agent.agentId,
            displayName: config.agent.agentDisplayName ?? config.agent.agentId,
        })
        : undefined;
    let ttsSink = () => { };
    let speakingController = null;
    let liveState = null;
    let roomRef = null;
    let mockRoom = null;
    let watchdogInterval = null;
    // Debug/diagnostics: track whether synthesized PCM is actually non-silent.
    const ttsEnergyByUtterance = new Map();
    const orchestrator = new orchestrator_1.Orchestrator(asr, llm, tts, memory, {
        vadSilenceMs: config.pipeline.vadSilenceMs,
        vadEnergyThreshold: config.pipeline.vadEnergyThreshold,
        vadAggressiveness: config.pipeline.vadAggressiveness,
        getFeedbackSentiment: () => feedbackCollector.getSentiment(),
        getFeedbackBehaviorLevel: () => feedbackCollector.getBehaviorLevel(persona.feedbackThresholds),
        promptManager,
        coordinatorClient,
    }, {
        onUserTranscript: (text) => logging_1.logger.info({ event: "USER_TRANSCRIPT", textLength: text.length }, "User said something"),
        onAgentReply: (text) => logging_1.logger.info({ event: "AGENT_REPLY", textLength: text.length }, "Agent replied"),
        onTtsAudio: (buffer, meta) => {
            if (meta?.utteranceId && speakingController && !speakingController.shouldPlay(meta.utteranceId))
                return;
            // Compute a cheap RMS estimate to detect "silent TTS" (all-zero buffers) which results in no audible bot audio.
            if (meta?.utteranceId) {
                const id = meta.utteranceId;
                const entry = ttsEnergyByUtterance.get(id) ?? { bytes: 0, sampleCount: 0, sumSq: 0, source: meta.source };
                entry.bytes += buffer.length;
                // Interpret as signed 16-bit little-endian PCM. Sample every 4th value for speed (still robust enough for silence detection).
                const len = buffer.length & ~1; // even
                for (let off = 0; off + 2 <= len; off += 8) {
                    const s = buffer.readInt16LE(off) / 32768;
                    entry.sumSq += s * s;
                    entry.sampleCount += 1;
                }
                ttsEnergyByUtterance.set(id, entry);
            }
            ttsSink(buffer);
        },
        onTtsStart: (meta) => {
            speakingController?.begin(meta.utteranceId, { source: meta.source });
            // Initialize energy tracking.
            if (!ttsEnergyByUtterance.has(meta.utteranceId)) {
                ttsEnergyByUtterance.set(meta.utteranceId, { bytes: 0, sampleCount: 0, sumSq: 0, source: meta.source });
            }
        },
        onTtsEnd: (meta) => {
            speakingController?.end(meta.utteranceId, { source: meta.source });
            const entry = ttsEnergyByUtterance.get(meta.utteranceId);
            if (entry) {
                const rms = entry.sampleCount > 0 ? Math.sqrt(entry.sumSq / entry.sampleCount) : 0;
                // Only warn when suspiciously silent to keep logs clean at LOG_LEVEL=warn.
                if (entry.bytes > 0 && rms <= 0.0001) {
                    logging_1.logger.warn({ event: "TTS_SILENT", utteranceId: meta.utteranceId, source: entry.source, bytes: entry.bytes, rms }, "TTS produced near-silence; bot audio will not be heard");
                }
                ttsEnergyByUtterance.delete(meta.utteranceId);
            }
        },
        onBargeIn: () => speakingController?.cancelAll("barge_in_user_speech"),
    });
    if (config.podium.token && config.podium.outpostUuid) {
        const room = new client_1.RoomClient({
            apiUrl: config.podium.apiUrl,
            wsAddress: config.podium.wsAddress,
            outpostServer: config.podium.outpostServer,
            token: config.podium.token,
            outpostUuid: config.podium.outpostUuid,
            useJitsiBot: config.podium.useJitsiBot,
            botPageUrl: config.podium.botPageUrl,
            jitsiXmppDomain: config.podium.jitsiXmppDomain,
            jitsiMucDomain: config.podium.jitsiMucDomain,
            jitsiJwt: config.podium.jitsiJwt,
            jitsiBridgePort: config.podium.jitsiBridgePort,
        });
        ttsSink = (buf) => room.pushTtsAudio(buf);
        room.onAudioChunk((chunk) => orchestrator.pushAudio(chunk));
        const joined = await room.join();
        roomRef = room;
        logging_1.logger.info("Joined Podium outpost room");
        // Configure reaction filtering now that we know the bot's wallet address.
        // FEEDBACK_REACT_TO_ADDRESS behavior:
        // - unset: count all reactions (room mood)
        // - "self": count only reactions targeting the bot
        // - "0x...": count only reactions targeting that address
        const rawReactTo = (config.agent.feedbackReactToAddress || "").trim();
        const filterAddress = rawReactTo.toLowerCase() === "self" ? joined.user.address : rawReactTo.length > 0 ? rawReactTo : undefined;
        feedbackCollector.setReactToUserAddressFilter(filterAddress);
        // Initialize live state (speaking-time rules) from REST snapshot + WS updates.
        liveState = new live_state_1.LiveState({
            selfAddress: joined.user.address,
            selfUuid: joined.user.uuid,
            creatorUuid: joined.outpost.creator_user_uuid,
        });
        try {
            const snapshot = await room.getLatestLiveData();
            liveState.applySnapshot(snapshot);
        }
        catch (err) {
            logging_1.logger.warn({ event: "LIVE_STATE_SNAPSHOT_FAILED", err: err.message }, "Failed to fetch live-data snapshot; continuing");
        }
        // Feed Podium WS events into feedback sentiment and live state.
        room.onWSMessage((msg) => {
            feedbackCollector.handleWSMessage(msg);
            liveState?.handleWSMessage(msg);
            if (liveState?.isSelfTimeUpEvent(msg)) {
                speakingController?.forceMute("user.time_is_up");
            }
        });
        speakingController = new speaking_controller_1.SpeakingController({
            outpostUuid: config.podium.outpostUuid,
            wsHealthy: () => room.wsConnected(),
            canSpeakNow: () => liveState?.canSpeakNow() ?? { allowed: true },
            startSpeaking: () => room.startSpeaking(),
            stopSpeaking: () => room.stopSpeaking(),
        });
        const greetingText = config.pipeline.greetingText?.trim() ?? "";
        const greetingDelayMs = config.pipeline.greetingDelayMs ?? 0;
        const openerEnabled = config.pipeline.openerEnabled ?? false;
        const openerDelayMs = config.pipeline.openerDelayMs ?? 0;
        const openerMaxTokens = config.pipeline.openerMaxTokens ?? 180;
        const outpostContextParts = [];
        if (joined.outpost.name)
            outpostContextParts.push(`Outpost name: ${joined.outpost.name}`);
        if (joined.outpost.subject)
            outpostContextParts.push(`Subject: ${joined.outpost.subject}`);
        if (joined.outpost.tags?.length)
            outpostContextParts.push(`Tags: ${joined.outpost.tags.join(", ")}`);
        const outpostContext = outpostContextParts.join(" | ");
        const inferredTopicSeed = (config.pipeline.topicSeed?.trim() || joined.outpost.subject?.trim() || joined.outpost.name?.trim() || joined.outpost.tags?.[0]?.trim() || "");
        if (greetingText && greetingDelayMs >= 0) {
            setTimeout(() => {
                orchestrator.speakProactively(greetingText).catch((err) => logging_1.logger.warn({ event: "GREETING_FAILED", err: err.message }, "Proactive greeting failed"));
            }, greetingDelayMs);
        }
        else if (openerEnabled && openerDelayMs >= 0) {
            setTimeout(() => {
                const allowed = liveState?.canSpeakNow() ?? { allowed: true };
                if (!allowed.allowed) {
                    logging_1.logger.info({ event: "OPENER_SKIPPED", reason: allowed.reason }, "Skipping opener (speaking not allowed)");
                    return;
                }
                orchestrator.speakOpener({ topicSeed: inferredTopicSeed, outpostContext, maxTokens: openerMaxTokens }).catch((err) => logging_1.logger.warn({ event: "OPENER_FAILED", err: err.message }, "Opener failed"));
            }, openerDelayMs);
        }
        const health = room.getHealthChecks();
        let lastRx = 0;
        let lastTx = 0;
        watchdogInterval = setInterval(() => {
            (0, metrics_1.runWatchdogTick)({ intervalMs: 30000, wsFailCountBeforeRestart: 3, conferenceFailCountBeforeRestart: 3, audioFailCountBeforeRestart: 5 }, {
                onWSUnhealthy: () => { logging_1.logger.warn("Watchdog: WS unhealthy; consider restarting process or reconnecting."); },
                onConferenceUnhealthy: () => { logging_1.logger.warn("Watchdog: Conference unhealthy; consider restarting process."); },
                onAudioUnhealthy: () => { logging_1.logger.warn("Watchdog: Audio pipeline unhealthy; consider restarting process."); },
            }, {
                ws: () => health.wsConnected(),
                conference: () => health.conferenceAlive(),
                audio: () => {
                    const rxTx = health.audioRxTx();
                    if (rxTx == null)
                        return true;
                    const advancing = rxTx.rx > lastRx || rxTx.tx > lastTx;
                    if (advancing) {
                        lastRx = rxTx.rx;
                        lastTx = rxTx.tx;
                    }
                    return advancing;
                },
            });
        }, 30000);
    }
    else {
        mockRoom = new mock_1.MockRoom({
            outputWavPath: process.env.MOCK_TTS_OUTPUT ?? "tts_output.wav",
        });
        ttsSink = (buf) => mockRoom.pushTtsAudio(buf);
        mockRoom.onAudioChunk((chunk) => orchestrator.pushAudio(chunk));
        await mockRoom.join();
        logging_1.logger.info("Using mock room; set PODIUM_TOKEN and PODIUM_OUTPOST_UUID to join real room");
        const greetingText = config.pipeline.greetingText?.trim() ?? "";
        const greetingDelayMs = config.pipeline.greetingDelayMs ?? 0;
        const openerEnabled = config.pipeline.openerEnabled ?? false;
        const openerDelayMs = config.pipeline.openerDelayMs ?? 0;
        const openerMaxTokens = config.pipeline.openerMaxTokens ?? 180;
        const topicSeed = config.pipeline.topicSeed?.trim() || "";
        if (greetingText && greetingDelayMs >= 0) {
            setTimeout(() => {
                orchestrator.speakProactively(greetingText).catch((err) => logging_1.logger.warn({ event: "GREETING_FAILED", err: err.message }, "Proactive greeting failed"));
            }, greetingDelayMs);
        }
        else if (openerEnabled && openerDelayMs >= 0) {
            setTimeout(() => {
                orchestrator.speakOpener({ topicSeed, outpostContext: "", maxTokens: openerMaxTokens }).catch((err) => logging_1.logger.warn({ event: "OPENER_FAILED", err: err.message }, "Opener failed"));
            }, openerDelayMs);
        }
    }
    process.on("SIGINT", async () => {
        if (watchdogInterval)
            clearInterval(watchdogInterval);
        if (mockRoom)
            mockRoom.flushTtsToFile();
        await roomRef?.leave();
        await mockRoom?.leave();
        process.exit(0);
    });
}
main().catch((err) => {
    (0, logging_1.logError)(logging_1.logger, err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map