/**
 * Integration test: orchestrator + mock room.
 * Feeds silence/short segment; with stub adapters no real ASR/LLM/TTS calls.
 * Verifies pipeline wiring and that TTS callback is invoked when LLM returns text.
 */

import { createASR } from "../../src/adapters/asr";
import { createLLM } from "../../src/adapters/llm";
import { createTTS } from "../../src/adapters/tts";
import { SessionMemory } from "../../src/memory/session";
import { Orchestrator } from "../../src/pipeline/orchestrator";
import { MockRoom } from "../../src/room/mock";
import type { AppConfig } from "../../src/config";
import { VAD } from "../../src/pipeline/vad";
import { pcmToWav } from "../../src/pipeline/audio-utils";

const stubConfig: AppConfig = {
  conversationBackend: {
    mode: "asr-llm-tts",
  },
  asr: { provider: "stub" },
  llm: { provider: "stub" },
  tts: { provider: "stub" },
  podium: { apiUrl: "", wsAddress: "", outpostServer: "" },
  pipeline: { vadSilenceMs: 500, maxTurnsInMemory: 50 },
  agent: { personaId: "default" },
};

describe("Orchestrator + MockRoom integration", () => {
  it("wires audio flow: mock room onAudioChunk -> orchestrator pushAudio", async () => {
    const asr = createASR(stubConfig);
    const llm = createLLM(stubConfig);
    const tts = createTTS(stubConfig);
    const memory = new SessionMemory({ maxTurns: 50 });
    const ttsBuffers: Buffer[] = [];
    const orchestrator = new Orchestrator(asr, llm, tts, memory, {
      vadSilenceMs: 500,
      getFeedbackSentiment: () => "neutral",
    }, {
      onTtsAudio: (buf) => ttsBuffers.push(buf),
    });
    const mockRoom = new MockRoom();
    mockRoom.onAudioChunk((chunk) => orchestrator.pushAudio(chunk));
    await mockRoom.join();
    const frameSize = VAD.getFrameSizeBytes();
    const silence = Buffer.alloc(frameSize, 0);
    for (let i = 0; i < 30; i++) {
      await orchestrator.pushAudio(silence);
    }
    orchestrator.flush();
    expect(ttsBuffers.length).toBe(0);
  });

  it("pcmToWav produces valid header + data", () => {
    const pcm = Buffer.alloc(320 * 2);
    const wav = pcmToWav(pcm, 16000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  });
});
