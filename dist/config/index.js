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
exports.validateConfig = validateConfig;
const fs = __importStar(require("fs"));
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
            vadEnergyThreshold: (() => {
                const v = getEnv("VAD_ENERGY_THRESHOLD");
                if (v == null || v === "")
                    return undefined;
                const n = parseInt(v, 10);
                return Number.isNaN(n) || n < 0 ? undefined : n;
            })(),
            vadAggressiveness: (() => {
                const v = getEnv("VAD_AGGRESSIVENESS");
                if (v == null || v === "")
                    return undefined;
                const n = parseInt(v, 10);
                return Number.isNaN(n) || n < 0 || n > 3 ? undefined : n;
            })(),
            maxTurnsInMemory: parseInt(getEnv("MAX_TURNS_IN_MEMORY") || "50", 10) || 50,
            /** GREETING_TEXT unset/empty = no greeting (use opener instead). */
            greetingText: getEnv("GREETING_TEXT") ?? "",
            greetingDelayMs: (() => {
                const v = getEnv("GREETING_DELAY_MS");
                if (v == null || v === "")
                    return 2000;
                const n = parseInt(v, 10);
                return Number.isNaN(n) || n < 0 ? 2000 : n;
            })(),
            openerEnabled: getEnv("OPENER_ENABLED") === "true" || getEnv("OPENER_ENABLED") === "1" || getEnv("OPENER_ENABLED") === undefined,
            openerDelayMs: (() => {
                const v = getEnv("OPENER_DELAY_MS");
                if (v == null || v === "")
                    return 2500;
                const n = parseInt(v, 10);
                return Number.isNaN(n) || n < 0 ? 2500 : n;
            })(),
            openerMaxTokens: (() => {
                const v = getEnv("OPENER_MAX_TOKENS");
                if (v == null || v === "")
                    return 180;
                const n = parseInt(v, 10);
                return Number.isNaN(n) || n <= 0 ? 180 : n;
            })(),
            topicSeed: getEnv("TOPIC_SEED"),
        },
    };
}
/**
 * Validate loaded config and env: ASR, LLM, TTS credentials and Podium settings.
 * Call after loadConfig() and log errors/warnings so operators see missing or placeholder values.
 */
function validateConfig(config) {
    const errors = [];
    const warnings = [];
    // --- Env file ---
    if (!fs.existsSync(envPath)) {
        warnings.push(`No .env.local found at ${envPath}. Using process.env only. Copy .env.example to .env.local and set values.`);
    }
    // --- ASR ---
    if (config.asr.provider === "openai" && !config.asr.openaiApiKey?.trim()) {
        errors.push("ASR is set to 'openai' but OPENAI_API_KEY is missing or empty in .env.local. Speech-to-text will use stub (no transcription).");
    }
    // --- LLM ---
    if (config.llm.provider === "openai" && !config.llm.openaiApiKey?.trim()) {
        errors.push("LLM is set to 'openai' but OPENAI_API_KEY is missing or empty in .env.local. Responses will use stub.");
    }
    if (config.llm.provider === "anthropic" && !config.llm.anthropicApiKey?.trim()) {
        errors.push("LLM is set to 'anthropic' but ANTHROPIC_API_KEY is missing or empty in .env.local.");
    }
    // --- TTS: Google ---
    if (config.tts.provider === "google") {
        const hasApiKey = Boolean(config.tts.googleApiKey?.trim());
        const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
        if (!hasApiKey && !adcPath) {
            errors.push("TTS is set to 'google' but neither Google_Cloud_TTS_API_KEY nor GOOGLE_APPLICATION_CREDENTIALS is set. " +
                "Set Google_Cloud_TTS_API_KEY in .env.local (and enable Text-to-Speech API), or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path. See .env.example.");
        }
        if (adcPath && !fs.existsSync(adcPath)) {
            errors.push(`GOOGLE_APPLICATION_CREDENTIALS is set to '${adcPath}' but the file does not exist. TTS will fail at runtime.`);
        }
    }
    // --- TTS: Azure ---
    if (config.tts.provider === "azure") {
        if (!config.tts.azureKey?.trim()) {
            errors.push("TTS is set to 'azure' but AZURE_TTS_KEY is missing or empty in .env.local.");
        }
        if (!config.tts.azureRegion?.trim()) {
            errors.push("TTS is set to 'azure' but AZURE_TTS_REGION is missing or empty in .env.local.");
        }
    }
    // --- Podium (when running in room mode) ---
    const hasPodiumToken = Boolean(config.podium.token?.trim());
    const hasOutpostUuid = Boolean(config.podium.outpostUuid?.trim());
    if (hasPodiumToken && !hasOutpostUuid) {
        warnings.push("PODIUM_TOKEN is set but PODIUM_OUTPOST_UUID is missing. Room client will not start. Set both in .env.local for live outpost mode.");
    }
    if (!hasPodiumToken && hasOutpostUuid) {
        warnings.push("PODIUM_OUTPOST_UUID is set but PODIUM_TOKEN is missing. Room client will not start. Set both in .env.local for live outpost mode.");
    }
    const apiUrlPlaceholder = /example\.com|your-podium|placeholder/i.test(config.podium.apiUrl || "");
    const wsPlaceholder = /example\.com|your-ws|placeholder/i.test(config.podium.wsAddress || "");
    if ((hasPodiumToken || hasOutpostUuid) && (apiUrlPlaceholder || wsPlaceholder)) {
        warnings.push("Podium API or WebSocket URL looks like a placeholder. Set NEXT_PUBLIC_PODIUM_API_URL and NEXT_PUBLIC_WEBSOCKET_ADDRESS to your real endpoints in .env.local.");
    }
    return { errors, warnings };
}
//# sourceMappingURL=index.js.map