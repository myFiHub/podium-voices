/**
 * Azure Cognitive Services Text-to-Speech adapter (optional).
 * Uses REST API with subscription key.
 */

import type { ITTS, VoiceOptions } from "./types";

export interface AzureTTSConfig {
  key: string;
  region: string;
  voiceName?: string;
}

export class AzureTTS implements ITTS {
  constructor(private readonly config: AzureTTSConfig) {}

  async synthesize(text: string, options?: VoiceOptions): Promise<Buffer> {
    const voiceName = options?.voiceName ?? this.config.voiceName ?? "en-US-JennyNeural";
    const region = this.config.region;
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.config.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
      },
      body: `<speak version='1.0' xml:lang='en-US'><voice name='${voiceName}'>${escapeXml(text)}</voice></speak>`,
    });
    if (!response.ok) throw new Error(`Azure TTS failed: ${response.status} ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
