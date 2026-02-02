/**
 * Google Cloud Text-to-Speech adapter.
 * Uses REST API with API key (env Google_Cloud_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY).
 */

import type { ITTS, VoiceOptions } from "./types";

export interface GoogleCloudTTSConfig {
  apiKey: string;
  voiceName?: string;
  languageCode?: string;
}

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export class GoogleCloudTTS implements ITTS {
  constructor(private readonly config: GoogleCloudTTSConfig) {}

  async synthesize(text: string, options?: VoiceOptions): Promise<Buffer> {
    const voiceName = options?.voiceName ?? this.config.voiceName ?? "en-US-Neural2-D";
    const languageCode = options?.languageCode ?? this.config.languageCode ?? "en-US";
    const sampleRate = options?.sampleRateHz ?? 48000;
    const url = `${SYNTHESIZE_URL}?key=${encodeURIComponent(this.config.apiKey)}`;
    const body = {
      input: { text },
      voice: { name: voiceName, languageCode },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: sampleRate },
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google TTS failed: ${response.status} ${errText}`);
    }
    const data = (await response.json()) as { audioContent?: string };
    const b64 = data.audioContent;
    if (!b64) return Buffer.alloc(0);
    return Buffer.from(b64, "base64");
  }
}
