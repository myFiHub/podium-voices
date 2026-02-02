/**
 * OpenAI Whisper API ASR adapter.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import OpenAI from "openai";
import type { IASR, TranscriptResult } from "./types";

export interface OpenAIWhisperConfig {
  apiKey: string;
}

export class OpenAIWhisperASR implements IASR {
  private client: OpenAI;

  constructor(private readonly config: OpenAIWhisperConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async transcribe(audioBuffer: Buffer, format: string = "wav"): Promise<TranscriptResult> {
    const ext = format === "webm" ? "webm" : "wav";
    const tmpPath = path.join(os.tmpdir(), `whisper-${Date.now()}.${ext}`);
    try {
      fs.writeFileSync(tmpPath, audioBuffer);
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: "whisper-1",
        response_format: "verbose_json",
      });
      const result = transcription as {
        text?: string;
        language?: string;
        words?: Array<{ word: string; start: number; end: number }>;
      };
      return {
        text: result.text ?? "",
        language: result.language,
        words: result.words,
      };
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }
}
