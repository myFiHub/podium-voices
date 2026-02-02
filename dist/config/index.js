"use strict";
/**
 * Env-based configuration for AI co-host MVP.
 * Load from .env.local (or process.env). Do not commit secrets.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
// Load .env.local from project root when not set
const envPath = path.resolve(process.cwd(), ".env.local");
(0, dotenv_1.config)({ path: envPath });
function getEnv(key, defaultValue) {
    const v = process.env[key];
    if (v === undefined || v === "")
        return defaultValue;
    return v.trim();
}
function getEnvRequired(key) {
    const v = getEnv(key);
    if (!v)
        throw new Error(`Missing required env: ${key}`);
    return v;
}
/**
 * Build config from environment variables.
 * ASR_PROVIDER, LLM_PROVIDER, TTS_PROVIDER select adapters (openai, anthropic, google, azure, stub).
 */
function loadConfig() {
    const asrProvider = (getEnv("ASR_PROVIDER") || "openai");
    const llmProvider = (getEnv("MODEL_PROVIDER") || getEnv("LLM_PROVIDER") || "openai");
    const ttsProvider = (getEnv("TTS_PROVIDER") || "google");
    return {
        asr: {
            provider: asrProvider,
            openaiApiKey: getEnv("OPENAI_API_KEY"),
        },
        llm: {
            provider: llmProvider,
            openaiApiKey: getEnv("OPENAI_API_KEY"),
            openaiModel: getEnv("OPENAI_MODEL_NAME") || "gpt-4o-mini",
            anthropicApiKey: getEnv("ANTHROPIC_API_KEY"),
            anthropicModel: getEnv("ANTHROPIC_MODEL_NAME") || "claude-3-5-sonnet-20241022",
        },
        tts: {
            provider: ttsProvider,
            googleApiKey: getEnv("Google_Cloud_TTS_API_KEY") || getEnv("GOOGLE_CLOUD_TTS_API_KEY"),
            googleVoiceName: getEnv("GOOGLE_TTS_VOICE_NAME") || "en-US-Neural2-D",
            azureKey: getEnv("AZURE_TTS_KEY"),
            azureRegion: getEnv("AZURE_TTS_REGION"),
            azureVoiceName: getEnv("AZURE_TTS_VOICE_NAME"),
        },
        podium: {
            apiUrl: getEnv("NEXT_PUBLIC_PODIUM_API_URL") || "https://api.podium.example.com/api/v1",
            wsAddress: getEnv("NEXT_PUBLIC_WEBSOCKET_ADDRESS") || "wss://ws.podium.example.com/ws",
            outpostServer: getEnv("NEXT_PUBLIC_OUTPOST_SERVER") || "meet.jit.si",
            token: getEnv("PODIUM_TOKEN"),
            outpostUuid: getEnv("PODIUM_OUTPOST_UUID"),
            useJitsiBot: getEnv("USE_JITSI_BOT") === "true" || getEnv("USE_JITSI_BOT") === "1",
            botPageUrl: getEnv("BOT_PAGE_URL"),
            jitsiXmppDomain: getEnv("JITSI_XMPP_DOMAIN"),
            jitsiMucDomain: getEnv("JITSI_MUC_DOMAIN"),
            jitsiJwt: getEnv("JITSI_JWT"),
            jitsiBridgePort: (() => {
                const v = getEnv("JITSI_BRIDGE_PORT");
                if (v == null || v === "")
                    return undefined;
                const n = parseInt(v, 10);
                return Number.isNaN(n) ? undefined : n;
            })(),
        },
        pipeline: {
            vadSilenceMs: parseInt(getEnv("VAD_SILENCE_MS") || "500", 10) || 500,
            maxTurnsInMemory: parseInt(getEnv("MAX_TURNS_IN_MEMORY") || "50", 10) || 50,
        },
    };
}
//# sourceMappingURL=index.js.map