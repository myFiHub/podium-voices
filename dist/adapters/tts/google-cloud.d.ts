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
export declare class GoogleCloudTTS implements ITTS {
    private readonly config;
    constructor(config: GoogleCloudTTSConfig);
    synthesize(text: string, options?: VoiceOptions): Promise<Buffer>;
}
//# sourceMappingURL=google-cloud.d.ts.map