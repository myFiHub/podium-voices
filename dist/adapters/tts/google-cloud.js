"use strict";
/**
 * Google Cloud Text-to-Speech adapter.
 * - With API key: REST API (env Google_Cloud_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY).
 * - Without API key: @google-cloud/text-to-speech client using Application Default
 *   Credentials (GOOGLE_APPLICATION_CREDENTIALS service account JSON), which avoids 401
 *   when the project does not allow API keys for TTS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCloudTTSADC = exports.GoogleCloudTTS = void 0;
const text_to_speech_1 = require("@google-cloud/text-to-speech");
const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
/** TTS using REST API with API key. */
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
class GoogleCloudTTSADC {
    config;
    client;
    constructor(config = {}) {
        this.config = config;
        this.client = new text_to_speech_1.TextToSpeechClient();
    }
    async synthesize(text, options) {
        const voiceName = options?.voiceName ?? this.config.voiceName ?? "en-US-Neural2-D";
        const languageCode = options?.languageCode ?? this.config.languageCode ?? "en-US";
        const sampleRate = options?.sampleRateHz ?? 48000;
        const [response] = await this.client.synthesizeSpeech({
            input: { text },
            voice: { name: voiceName, languageCode },
            audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: sampleRate },
        });
        const content = response.audioContent;
        if (!content || !(content instanceof Uint8Array))
            return Buffer.alloc(0);
        return Buffer.from(content);
    }
}
exports.GoogleCloudTTSADC = GoogleCloudTTSADC;
//# sourceMappingURL=google-cloud.js.map