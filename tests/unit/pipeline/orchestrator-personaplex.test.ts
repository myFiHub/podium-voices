import { Orchestrator } from "../../../src/pipeline/orchestrator";
import { SessionMemory } from "../../../src/memory/session";
import { PromptManager } from "../../../src/prompts/prompt-manager";

describe("Orchestrator (PersonaPlex mode)", () => {
  it("runs PersonaPlex path and emits TTS audio + agent reply", async () => {
    const memory = new SessionMemory({ maxTurns: 10 });
    const promptManager = new PromptManager({ systemPrompt: "You are a helpful co-host." });

    const asr = {
      async transcribe() {
        return { text: "hey there" };
      },
    };

    // Not used in PersonaPlex mode unless fallback is enabled.
    const llm = {
      async chat() {
        return { text: "fallback", stream: undefined };
      },
    };
    const tts = {
      async synthesize() {
        return Buffer.alloc(0);
      },
    };

    const personaplexClient = {
      async runTurn() {
        async function* audio48k() {
          // 20ms of silence @ 48kHz: 48000 * 0.02 * 2 = 1920 bytes
          yield Buffer.alloc(1920);
        }
        return {
          audio48k: audio48k(),
          text: Promise.resolve("Hi!"),
          abort: () => {},
        };
      },
    };

    const ttsChunks: Buffer[] = [];
    const agentReplies: string[] = [];
    const userTranscripts: string[] = [];

    const orch = new Orchestrator(
      asr as any,
      llm as any,
      tts as any,
      memory,
      {
        vadSilenceMs: 500,
        conversationBackendMode: "personaplex",
        personaplexClient: personaplexClient as any,
        promptManager,
      },
      {
        onUserTranscript: (t) => userTranscripts.push(t),
        onAgentReply: (t) => agentReplies.push(t),
        onTtsAudio: (b) => ttsChunks.push(b),
      }
    );

    // Call the PersonaPlex turn path directly (unit-level).
    await (orch as any).runTurnPersonaPlex(Buffer.alloc(Math.round(16000 * 0.2) * 2));

    expect(userTranscripts.join(" ")).toContain("hey");
    expect(agentReplies.join(" ")).toContain("Hi");
    expect(ttsChunks.length).toBeGreaterThan(0);
  });
});

