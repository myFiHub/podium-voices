/**
 * Env-based configuration for AI co-host MVP.
 * Load from .env.local (or process.env). Do not commit secrets.
 */

import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";

// Load .env.local from project root when not set
const envPath = path.resolve(process.cwd(), ".env.local");
loadEnv({ path: envPath });

export type AsrProvider = "openai" | "whisper-local" | "stub";
export type LlmProvider = "openai" | "anthropic" | "stub";
export type TtsProvider = "google" | "azure" | "stub";

export interface AppConfig {
  /** ASR (speech-to-text) provider and options */
  asr: {
    provider: AsrProvider;
    openaiApiKey?: string;
    /** Server-local Whisper model name or path (e.g. tiny|base|small). */
    whisperModel?: string;
    /** Local Whisper engine selector (e.g. faster-whisper | whisper-cpp). */
    whisperEngine?: string;
    /** Optional Python interpreter path for python-based engines (e.g. faster-whisper). */
    whisperPythonPath?: string;
  };

  /** LLM provider and options */
  llm: {
    provider: LlmProvider;
    openaiApiKey?: string;
    openaiModel?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
  };

  /** TTS (text-to-speech) provider and options */
  tts: {
    provider: TtsProvider;
    googleApiKey?: string;
    googleVoiceName?: string;
    azureKey?: string;
    azureRegion?: string;
    azureVoiceName?: string;
  };

  /** Podium / Outpost room integration */
  podium: {
    apiUrl: string;
    wsAddress: string;
    outpostServer: string; // Jitsi hostname fallback
    token?: string;
    outpostUuid?: string;
    /** Use browser bot for Jitsi (real audio in/out). When false, JitsiStub is used. */
    useJitsiBot?: boolean;
    /** URL of the minimal bot join page (e.g. http://localhost:8765/bot.html). If unset, Node serves bot-page/ and uses that. */
    botPageUrl?: string;
    /** XMPP domain for Jitsi (Prosody VirtualHost, e.g. meet.jitsi). When public URL is different (e.g. outposts.myfihub.com), set this so JIDs use the correct domain. */
    jitsiXmppDomain?: string;
    /** XMPP MUC domain for conference rooms (room JID = roomName@muc). Jitsi Docker uses muc.<domain> (e.g. muc.meet.jitsi); default in bot is conference.<xmppDomain> if unset. */
    jitsiMucDomain?: string;
    /** JWT for Jitsi/Prosody meeting join. Only needed when the deployment requires JWT auth to join the conference. */
    jitsiJwt?: string;
    /** First port to try for the Jitsi bot bridge (default 8766). If in use, the next ports are tried automatically. */
    jitsiBridgePort?: number;
  };

  /** Pipeline tuning */
  pipeline: {
    /** Silence duration (ms) to consider end of turn */
    vadSilenceMs: number;
    /** Energy-based VAD threshold (RMS of 16-bit samples); lower = more sensitive. Used when webrtcvad is unavailable. */
    vadEnergyThreshold?: number;
    /** WebRTC VAD aggressiveness 0–3 (0=least, 3=most). Only when webrtcvad native module is used. */
    vadAggressiveness?: number;
    /** Max recent turns to keep in session memory */
    maxTurnsInMemory: number;
    /** Optional greeting spoken by the bot when it joins the room (starts the dialogue). Empty = no greeting. */
    greetingText?: string;
    /** Delay (ms) after room join before speaking the greeting (allows participants to hear; 0 = immediate). */
    greetingDelayMs?: number;
    /** If true, generate a storyteller-style opener via LLM after join (when greetingText is empty). */
    openerEnabled?: boolean;
    /** Delay (ms) after room join before generating/speaking the opener. */
    openerDelayMs?: number;
    /** Max tokens for opener generation (LLM). */
    openerMaxTokens?: number;
    /** Optional topic seed override (env/config). */
    topicSeed?: string;
  };

  /** Agent/persona behavior configuration */
  agent: {
    /** Which persona to run (maps to a persona registry). */
    personaId: string;
    /**
     * Optional: filter which reactions are counted for feedback.
     * - unset/empty: count ALL room reactions (room mood)
     * - "self": count only reactions targeting the bot's wallet address (resolved after join)
     * - "0x...": count only reactions targeting that wallet address
     */
    feedbackReactToAddress?: string;
    /** Multi-agent: unique id for this agent process (used by Turn Coordinator). */
    agentId?: string;
    /** Multi-agent: display name for name-addressing (e.g. "Alex", "Jamie"). */
    agentDisplayName?: string;
    /** Multi-agent: Turn Coordinator base URL. When set, agent uses coordinator for turn-taking. */
    coordinatorUrl?: string;
  };
}

function getEnv(key: string, defaultValue?: string): string | undefined {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v.trim();
}

function getEnvRequired(key: string): string {
  const v = getEnv(key);
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

/**
 * Build config from environment variables.
 * ASR_PROVIDER, LLM_PROVIDER, TTS_PROVIDER select adapters (openai, anthropic, google, azure, stub).
 */
export function loadConfig(): AppConfig {
  const asrProvider = (getEnv("ASR_PROVIDER") || "openai") as AsrProvider;
  const llmProvider = (getEnv("MODEL_PROVIDER") || getEnv("LLM_PROVIDER") || "openai") as LlmProvider;
  const ttsProvider = (getEnv("TTS_PROVIDER") || "google") as TtsProvider;

  return {
    asr: {
      provider: asrProvider,
      openaiApiKey: getEnv("OPENAI_API_KEY"),
      whisperModel: getEnv("WHISPER_MODEL") || "base",
      whisperEngine: getEnv("WHISPER_ENGINE") || "faster-whisper",
      whisperPythonPath: getEnv("WHISPER_PYTHON_PATH"),
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
        if (v == null || v === "") return undefined;
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? undefined : n;
      })(),
    },
    pipeline: {
      vadSilenceMs: parseInt(getEnv("VAD_SILENCE_MS") || "500", 10) || 500,
      vadEnergyThreshold: (() => {
        const v = getEnv("VAD_ENERGY_THRESHOLD");
        if (v == null || v === "") return undefined;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? undefined : n;
      })(),
      vadAggressiveness: (() => {
        const v = getEnv("VAD_AGGRESSIVENESS");
        if (v == null || v === "") return undefined;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 || n > 3 ? undefined : n;
      })(),
      maxTurnsInMemory: parseInt(getEnv("MAX_TURNS_IN_MEMORY") || "50", 10) || 50,
      /** GREETING_TEXT unset/empty = no greeting (use opener instead). */
      greetingText: getEnv("GREETING_TEXT") ?? "",
      greetingDelayMs: (() => {
        const v = getEnv("GREETING_DELAY_MS");
        if (v == null || v === "") return 2000;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 2000 : n;
      })(),
      openerEnabled: getEnv("OPENER_ENABLED") === "true" || getEnv("OPENER_ENABLED") === "1" || getEnv("OPENER_ENABLED") === undefined,
      openerDelayMs: (() => {
        const v = getEnv("OPENER_DELAY_MS");
        if (v == null || v === "") return 2500;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 2500 : n;
      })(),
      openerMaxTokens: (() => {
        const v = getEnv("OPENER_MAX_TOKENS");
        if (v == null || v === "") return 180;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n <= 0 ? 180 : n;
      })(),
      topicSeed: getEnv("TOPIC_SEED"),
    },
    agent: {
      personaId: getEnv("PERSONA_ID") || "default",
      feedbackReactToAddress: getEnv("FEEDBACK_REACT_TO_ADDRESS"),
      agentId: getEnv("AGENT_ID"),
      agentDisplayName: getEnv("AGENT_DISPLAY_NAME"),
      coordinatorUrl: getEnv("COORDINATOR_URL"),
    },
  };
}

/** Result of configuration validation: errors block correct operation, warnings indicate likely misconfiguration. */
export interface ConfigValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate loaded config and env: ASR, LLM, TTS credentials and Podium settings.
 * Call after loadConfig() and log errors/warnings so operators see missing or placeholder values.
 */
export function validateConfig(config: AppConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Env file ---
  if (!fs.existsSync(envPath)) {
    warnings.push(`No .env.local found at ${envPath}. Using process.env only. Copy .env.example to .env.local and set values.`);
  }

  // --- ASR ---
  if (config.asr.provider === "openai" && !config.asr.openaiApiKey?.trim()) {
    errors.push("ASR is set to 'openai' but OPENAI_API_KEY is missing or empty in .env.local. Speech-to-text will use stub (no transcription).");
  }
  if (config.asr.provider === "whisper-local") {
    // Local Whisper is intentionally permissive: operators may choose any model/engine they have installed.
    // We surface likely misconfiguration as warnings, not errors, so the app can still boot (and fall back to stub in factory if needed).
    if (!config.asr.whisperModel?.trim()) {
      warnings.push("ASR is set to 'whisper-local' but WHISPER_MODEL is empty. Defaulting to 'base'.");
    }
    if (!config.asr.whisperEngine?.trim()) {
      warnings.push("ASR is set to 'whisper-local' but WHISPER_ENGINE is empty. Defaulting to 'faster-whisper'.");
    }
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
      errors.push(
        "TTS is set to 'google' but neither Google_Cloud_TTS_API_KEY nor GOOGLE_APPLICATION_CREDENTIALS is set. " +
          "Set Google_Cloud_TTS_API_KEY in .env.local (and enable Text-to-Speech API), or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path. See .env.example."
      );
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
    warnings.push(
      "Podium API or WebSocket URL looks like a placeholder. Set NEXT_PUBLIC_PODIUM_API_URL and NEXT_PUBLIC_WEBSOCKET_ADDRESS to your real endpoints in .env.local."
    );
  }

  return { errors, warnings };
}
