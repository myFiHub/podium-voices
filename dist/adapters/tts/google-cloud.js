"use strict";
/**
 * Google Cloud Text-to-Speech adapter.
 * Uses REST API with API key (env Google_Cloud_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCloudTTS = void 0;
const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
class GoogleCloudTTS {
    config;
    constructor(config) {
        this.config = config;
    }
    async synthesize(text, options) {
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
        const data = (await response.json());
        const b64 = data.audioContent;
        if (!b64)
            return Buffer.alloc(0);
        return Buffer.from(b64, "base64");
    }
}
exports.GoogleCloudTTS = GoogleCloudTTS;
//# sourceMappingURL=google-cloud.js.map