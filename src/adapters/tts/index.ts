/**
 * TTS adapter factory: returns implementation based on config.
 */

import type { AppConfig } from "../../config";
import type { ITTS } from "./types";
import { StubTTS } from "./stub";
import { GoogleCloudTTS, GoogleCloudTTSADC } from "./google-cloud";
import { AzureTTS } from "./azure";

export type { ITTS, VoiceOptions } from "./types";
export { ttsToStream } from "./types";
export { StubTTS } from "./stub";
export { GoogleCloudTTS, GoogleCloudTTSADC } from "./google-cloud";
export { AzureTTS } from "./azure";

export function createTTS(config: AppConfig): ITTS {
  const { provider, googleApiKey, googleVoiceName, azureKey, azureRegion, azureVoiceName } = config.tts;
  if (provider === "google") {
    if (googleApiKey) {
      return new GoogleCloudTTS({
        apiKey: googleApiKey,
        voiceName: googleVoiceName,
        languageCode: "en-US",
      });
    }
    return new GoogleCloudTTSADC({
      voiceName: googleVoiceName,
      languageCode: "en-US",
    });
  }
  if (provider === "azure" && azureKey && azureRegion) {
    return new AzureTTS({ key: azureKey, region: azureRegion, voiceName: azureVoiceName });
  }
  return new StubTTS();
}
