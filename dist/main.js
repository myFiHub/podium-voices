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
async function main() {
    const config = (0, config_1.loadConfig)();
    const asr = (0, asr_1.createASR)(config);
    const llm = (0, llm_1.createLLM)(config);
    const tts = (0, tts_1.createTTS)(config);
    const memory = new session_1.SessionMemory({ maxTurns: config.pipeline.maxTurnsInMemory });
    const feedbackCollector = new collector_1.FeedbackCollector({ windowMs: 60_000 });
    let ttsSink = () => { };
    let roomRef = null;
    let mockRoom = null;
    let watchdogInterval = null;
    const orchestrator = new orchestrator_1.Orchestrator(asr, llm, tts, memory, {
        vadSilenceMs: config.pipeline.vadSilenceMs,
        getFeedbackSentiment: () => feedbackCollector.getSentiment(),
    }, {
        onUserTranscript: (text) => logging_1.logger.info({ event: "USER_TRANSCRIPT", textLength: text.length }, "User said something"),
        onAgentReply: (text) => logging_1.logger.info({ event: "AGENT_REPLY", textLength: text.length }, "Agent replied"),
        onTtsAudio: (buffer) => ttsSink(buffer),
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
        await room.join();
        roomRef = room;
        logging_1.logger.info("Joined Podium outpost room");
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