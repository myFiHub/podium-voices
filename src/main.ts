/**
 * Entry point: load config, optionally start room client + orchestrator.
 * Use mock room when PODIUM_TOKEN or PODIUM_OUTPOST_UUID are not set.
 */

import { loadConfig } from "./config";
import { createASR } from "./adapters/asr";
import { createLLM } from "./adapters/llm";
import { createTTS } from "./adapters/tts";
import { SessionMemory } from "./memory/session";
import { Orchestrator } from "./pipeline/orchestrator";
import { FeedbackCollector } from "./feedback/collector";
import { logger, logError } from "./logging";
import { runWatchdogTick } from "./metrics";
import { MockRoom } from "./room/mock";
import { RoomClient } from "./room/client";

async function main(): Promise<void> {
  const config = loadConfig();
  const asr = createASR(config);
  const llm = createLLM(config);
  const tts = createTTS(config);
  const memory = new SessionMemory({ maxTurns: config.pipeline.maxTurnsInMemory });
  const feedbackCollector = new FeedbackCollector({ windowMs: 60_000 });

  let ttsSink: (buffer: Buffer) => void = () => {};
  let roomRef: RoomClient | null = null;
  let mockRoom: MockRoom | null = null;
  let watchdogInterval: ReturnType<typeof setInterval> | null = null;

  const orchestrator = new Orchestrator(asr, llm, tts, memory, {
    vadSilenceMs: config.pipeline.vadSilenceMs,
    getFeedbackSentiment: () => feedbackCollector.getSentiment(),
  }, {
    onUserTranscript: (text) => logger.info({ event: "USER_TRANSCRIPT", textLength: text.length }, "User said something"),
    onAgentReply: (text) => logger.info({ event: "AGENT_REPLY", textLength: text.length }, "Agent replied"),
    onTtsAudio: (buffer) => ttsSink(buffer),
  });

  if (config.podium.token && config.podium.outpostUuid) {
    const room = new RoomClient({
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
    logger.info("Joined Podium outpost room");
    const greetingText = config.pipeline.greetingText?.trim();
    const greetingDelayMs = config.pipeline.greetingDelayMs ?? 0;
    if (greetingText && greetingDelayMs >= 0) {
      setTimeout(() => {
        orchestrator.speakProactively(greetingText).catch((err) =>
          logger.warn({ event: "GREETING_FAILED", err: (err as Error).message }, "Proactive greeting failed")
        );
      }, greetingDelayMs);
    }
    const health = room.getHealthChecks();
    let lastRx = 0;
    let lastTx = 0;
    watchdogInterval = setInterval(() => {
      runWatchdogTick(
        { intervalMs: 30000, wsFailCountBeforeRestart: 3, conferenceFailCountBeforeRestart: 3, audioFailCountBeforeRestart: 5 },
        {
          onWSUnhealthy: () => { logger.warn("Watchdog: WS unhealthy; consider restarting process or reconnecting."); },
          onConferenceUnhealthy: () => { logger.warn("Watchdog: Conference unhealthy; consider restarting process."); },
          onAudioUnhealthy: () => { logger.warn("Watchdog: Audio pipeline unhealthy; consider restarting process."); },
        },
        {
          ws: () => health.wsConnected(),
          conference: () => health.conferenceAlive(),
          audio: () => {
            const rxTx = health.audioRxTx();
            if (rxTx == null) return true;
            const advancing = rxTx.rx > lastRx || rxTx.tx > lastTx;
            if (advancing) {
              lastRx = rxTx.rx;
              lastTx = rxTx.tx;
            }
            return advancing;
          },
        }
      );
    }, 30000);
  } else {
    mockRoom = new MockRoom({
      outputWavPath: process.env.MOCK_TTS_OUTPUT ?? "tts_output.wav",
    });
    ttsSink = (buf) => mockRoom!.pushTtsAudio(buf);
    mockRoom.onAudioChunk((chunk) => orchestrator.pushAudio(chunk));
    await mockRoom.join();
    logger.info("Using mock room; set PODIUM_TOKEN and PODIUM_OUTPOST_UUID to join real room");
    const greetingText = config.pipeline.greetingText?.trim();
    const greetingDelayMs = config.pipeline.greetingDelayMs ?? 0;
    if (greetingText && greetingDelayMs >= 0) {
      setTimeout(() => {
        orchestrator.speakProactively(greetingText).catch((err) =>
          logger.warn({ event: "GREETING_FAILED", err: (err as Error).message }, "Proactive greeting failed")
        );
      }, greetingDelayMs);
    }
  }

  process.on("SIGINT", async () => {
    if (watchdogInterval) clearInterval(watchdogInterval);
    if (mockRoom) mockRoom.flushTtsToFile();
    await roomRef?.leave();
    await mockRoom?.leave();
    process.exit(0);
  });
}

main().catch((err) => {
  logError(logger, err);
  process.exit(1);
});
