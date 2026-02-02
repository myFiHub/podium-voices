/**
 * Mock room for local testing: no Podium connection.
 * Optionally feed audio from a WAV file and capture TTS output to a buffer or file.
 */

import * as fs from "fs";
import * as path from "path";
import { VAD } from "../pipeline/vad";
import { pcmToWav } from "../pipeline/audio-utils";

export interface MockRoomConfig {
  /** Optional path to WAV file to use as simulated room audio (16kHz mono 16-bit). */
  inputWavPath?: string;
  /** Optional path to write TTS output WAV. */
  outputWavPath?: string;
}

export interface MockRoomCallbacks {
  onAudioChunk?(buffer: Buffer): void;
}

export class MockRoom {
  private ttsBuffers: Buffer[] = [];
  private callbacks: MockRoomCallbacks = {};
  private readonly config: MockRoomConfig;

  constructor(config: MockRoomConfig = {}) {
    this.config = config;
  }

  onAudioChunk(cb: (buffer: Buffer) => void): void {
    this.callbacks.onAudioChunk = cb;
  }

  /**
   * Push TTS audio (e.g. from orchestrator callback). Accumulates; flush to file with flushTtsToFile().
   */
  pushTtsAudio(buffer: Buffer): void {
    this.ttsBuffers.push(buffer);
  }

  /** Get accumulated TTS audio as single buffer. */
  getTtsBuffer(): Buffer {
    return Buffer.concat(this.ttsBuffers);
  }

  /** Write accumulated TTS to WAV file (48kHz mono 16-bit) and clear buffer. */
  flushTtsToFile(filePath?: string): string {
    const outPath = filePath ?? this.config.outputWavPath;
    if (!outPath) throw new Error("No output path");
    const pcm = Buffer.concat(this.ttsBuffers);
    this.ttsBuffers = [];
    const wav = pcmToWav(pcm, 48000);
    fs.writeFileSync(outPath, wav);
    return outPath;
  }

  /**
   * Simulate room audio by reading a WAV file and feeding chunks to onAudioChunk.
   * Expects 16kHz mono 16-bit WAV for VAD. Chunk size = VAD frame size.
   */
  feedFromWav(wavPath?: string): void {
    const p = wavPath ?? this.config.inputWavPath;
    if (!p || !fs.existsSync(p)) return;
    const buf = fs.readFileSync(p);
    const dataOffset = 44;
    const pcm = buf.subarray(dataOffset);
    const frameSize = VAD.getFrameSizeBytes();
    let offset = 0;
    while (offset + frameSize <= pcm.length) {
      this.callbacks.onAudioChunk?.(pcm.subarray(offset, offset + frameSize));
      offset += frameSize;
    }
  }

  /** Simulate joining (no-op). */
  async join(): Promise<{ user: { uuid: string; address: string; name: string }; outpost: { uuid: string } }> {
    return {
      user: { uuid: "mock-user", address: "0xmock", name: "Mock User" },
      outpost: { uuid: "mock-outpost" },
    };
  }

  async leave(): Promise<void> {}
}
