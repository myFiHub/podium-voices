"use strict";
/**
 * TTS adapter factory: returns implementation based on config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureTTS = exports.GoogleCloudTTS = exports.StubTTS = exports.ttsToStream = void 0;
exports.createTTS = createTTS;
const stub_1 = require("./stub");
const google_cloud_1 = require("./google-cloud");
const azure_1 = require("./azure");
var types_1 = require("./types");
Object.defineProperty(exports, "ttsToStream", { enumerable: true, get: function () { return types_1.ttsToStream; } });
var stub_2 = require("./stub");
Object.defineProperty(exports, "StubTTS", { enumerable: true, get: function () { return stub_2.StubTTS; } });
var google_cloud_2 = require("./google-cloud");
Object.defineProperty(exports, "GoogleCloudTTS", { enumerable: true, get: function () { return google_cloud_2.GoogleCloudTTS; } });
var azure_2 = require("./azure");
Object.defineProperty(exports, "AzureTTS", { enumerable: true, get: function () { return azure_2.AzureTTS; } });
function createTTS(config) {
    const { provider, googleApiKey, googleVoiceName, azureKey, azureRegion, azureVoiceName } = config.tts;
    if (provider === "google" && googleApiKey) {
        return new google_cloud_1.GoogleCloudTTS({
            apiKey: googleApiKey,
            voiceName: googleVoiceName,
            languageCode: "en-US",
        });
    }
    if (provider === "azure" && azureKey && azureRegion) {
        return new azure_1.AzureTTS({ key: azureKey, region: azureRegion, voiceName: azureVoiceName });
    }
    return new stub_1.StubTTS();
}
//# sourceMappingURL=index.js.map