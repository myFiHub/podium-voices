import { WebSocketServer } from "ws";
import { OpusEncoder } from "@discordjs/opus";
import { PersonaPlexClient } from "../../../src/adapters/personaplex";
import { resampleS16leMonoLinear } from "../../../src/audio/pcm-utils";

function makeTone24kFrame(): Buffer {
  const sampleRate = 24000;
  const frameMs = 20;
  const samples = Math.round((sampleRate * frameMs) / 1000); // 480
  const out = Buffer.alloc(samples * 2);
  const freqHz = 440;
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const s = Math.round(Math.sin(2 * Math.PI * freqHz * t) * 0.25 * 32767);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

describe("PersonaPlexClient", () => {
  it("streams audio and collects text tokens", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const addr = wss.address();
    if (addr == null || typeof addr === "string") throw new Error("Unexpected ws address");
    const port = addr.port;

    // Minimal mock PersonaPlex protocol.
    wss.on("connection", (socket) => {
      // handshake
      socket.send(Buffer.from([0x00]));

      socket.on("message", (data, isBinary) => {
        if (!isBinary) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf.length < 2) return;
        const kind = buf[0];
        if (kind !== 0x01) return;

        // Respond with one token and one audio packet, then close.
        socket.send(Buffer.concat([Buffer.from([0x02]), Buffer.from(" hello", "utf8")]));

        const encoder = new OpusEncoder(24000, 1);
        const pcm = makeTone24kFrame();
        const opus = encoder.encode(pcm);
        socket.send(Buffer.concat([Buffer.from([0x01]), opus]));

        setTimeout(() => socket.close(), 25);
      });
    });

    try {
      const client = new PersonaPlexClient({
        serverUrl: `http://127.0.0.1:${port}`,
        voicePrompt: "NATF2.pt",
        turnTimeoutMs: 5_000,
      });

      // 200ms silence at 16kHz
      const pcm16 = Buffer.alloc(Math.round(16000 * 0.2) * 2);
      const turn = await client.runTurn({ userPcm16k: pcm16, textPrompt: "You enjoy having a good conversation." });

      const received: Buffer[] = [];
      for await (const chunk of turn.audio48k) {
        received.push(chunk);
      }
      const text = await turn.text;

      expect(text).toContain("hello");
      expect(received.length).toBeGreaterThan(0);

      // Basic sanity: chunk should be 48k-ish resampled (we can't assert exact length, but it should be non-trivial)
      const totalBytes = received.reduce((sum, b) => sum + b.length, 0);
      expect(totalBytes).toBeGreaterThan(200);

      // Also sanity-check our resampler isn't returning empty output.
      const tone24 = makeTone24kFrame();
      const tone48 = resampleS16leMonoLinear(tone24, 24000, 48000);
      expect(tone48.length).toBeGreaterThan(tone24.length);
    } finally {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});

