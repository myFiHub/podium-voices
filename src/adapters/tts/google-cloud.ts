/**
 * Google Cloud Text-to-Speech adapter.
 * - With API key: REST API (env Google_Cloud_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY).
 * - Without API key: @google-cloud/text-to-speech client using Application Default
 *   Credentials (GOOGLE_APPLICATION_CREDENTIALS service account JSON), which avoids 401
 *   when the project does not allow API keys for TTS.
 */

import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type { ITTS, VoiceOptions } from "./types";

export interface GoogleCloudTTSConfig {
  apiKey: string;
  voiceName?: string;
  languageCode?: string;
}

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** TTS using REST API with API key. */
export class GoogleCloudTTS implements ITTS {
  constructor(private readonly config: GoogleCloudTTSConfig) {}

  async synthesize(text: string, options?: VoiceOptions): Promise<Buffer> {
    const voiceName = options?.voiceName ?? this.config.voiceName ?? "en-US-Neural2-D";
    const languageCode = options?.languageCode ?? this.config.languageCode ?? "en-US";
    const sampleRate = options?.sampleRateHz ?? 48000;
    const audioConfig: Record<string, unknown> = {
      audioEncoding: "LINEAR16",
      sampleRateHertz: sampleRate,
    };
    if (options?.speakingRate != null) audioConfig.speakingRate = options.speakingRate;
    if (options?.pitch != null) audioConfig.pitch = options.pitch;
    const url = `${SYNTHESIZE_URL}?key=${encodeURIComponent(this.config.apiKey)}`;
    const body = {
      input: { text },
      voice: { name: voiceName, languageCode },
      audioConfig,
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

/** TTS using official Node client and Application Default Credentials (OAuth2 / service account). */
export interface GoogleCloudTTSADCConfig {
  voiceName?: string;
  languageCode?: string;
}

export class GoogleCloudTTSADC implements ITTS {
  private readonly client: TextToSpeechClient;
  constructor(private readonly config: GoogleCloudTTSADCConfig = {}) {
    this.client = new TextToSpeechClient();
  }

  async synthesize(text: string, options?: VoiceOptions): Promise<Buffer> {
    const voiceName = options?.voiceName ?? this.config.voiceName ?? "en-US-Neural2-D";
    const languageCode = options?.languageCode ?? this.config.languageCode ?? "en-US";
    const sampleRate = options?.sampleRateHz ?? 48000;
    const audioConfig: Record<string, unknown> = {
      audioEncoding: "LINEAR16",
      sampleRateHertz: sampleRate,
    };
    if (options?.speakingRate != null) audioConfig.speakingRate = options.speakingRate;
    if (options?.pitch != null) audioConfig.pitch = options.pitch;
    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: { name: voiceName, languageCode },
      audioConfig,
    });
    const content = response.audioContent;
    if (!content || !(content instanceof Uint8Array)) return Buffer.alloc(0);
    return Buffer.from(content);
  }
}
