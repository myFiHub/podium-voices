/**
 * Google Cloud Text-to-Speech adapter.
 * - With API key: REST API (env Google_Cloud_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY).
 * - Without API key: @google-cloud/text-to-speech client using Application Default
 *   Credentials (GOOGLE_APPLICATION_CREDENTIALS service account JSON), which avoids 401
 *   when the project does not allow API keys for TTS.
 */
import type { ITTS, VoiceOptions } from "./types";
export interface GoogleCloudTTSConfig {
    apiKey: string;
    voiceName?: string;
    languageCode?: string;
}
/** TTS using REST API with API key. */
export declare class GoogleCloudTTS implements ITTS {
    private readonly config;
    constructor(config: GoogleCloudTTSConfig);
    synthesize(text: string, options?: VoiceOptions): Promise<Buffer>;
}
/** TTS using official Node client and Application Default Credentials (OAuth2 / service account). */
export interface GoogleCloudTTSADCConfig {
    voiceName?: string;
    languageCode?: string;
}
export declare class GoogleCloudTTSADC implements ITTS {
    private readonly config;
    private readonly client;
    constructor(config?: GoogleCloudTTSADCConfig);
    synthesize(text: string, options?: VoiceOptions): Promise<Buffer>;
}
//# sourceMappingURL=google-cloud.d.ts.map