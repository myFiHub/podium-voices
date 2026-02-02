/**
 * Env-based configuration for AI co-host MVP.
 * Load from .env.local (or process.env). Do not commit secrets.
 */

import * as path from "path";
import { config as loadEnv } from "dotenv";

// Load .env.local from project root when not set
const envPath = path.resolve(process.cwd(), ".env.local");
loadEnv({ path: envPath });

export type AsrProvider = "openai" | "stub";
export type LlmProvider = "openai" | "anthropic" | "stub";
export type TtsProvider = "google" | "azure" | "stub";

export interface AppConfig {
  /** ASR (speech-to-text) provider and options */
  asr: {
    provider: AsrProvider;
    openaiApiKey?: string;
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
    /** Max recent turns to keep in session memory */
    maxTurnsInMemory: number;
    /** Optional greeting spoken by the bot when it joins the room (starts the dialogue). Empty = no greeting. */
    greetingText?: string;
    /** Delay (ms) after room join before speaking the greeting (allows participants to hear; 0 = immediate). */
    greetingDelayMs?: number;
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
      maxTurnsInMemory: parseInt(getEnv("MAX_TURNS_IN_MEMORY") || "50", 10) || 50,
      /** GREETING_TEXT unset = default greeting; set to empty string = no greeting. */
      greetingText: (() => {
        const v = getEnv("GREETING_TEXT");
        return v === undefined ? "Hello! I'm the AI co-host. What would you like to talk about?" : v;
      })(),
      greetingDelayMs: (() => {
        const v = getEnv("GREETING_DELAY_MS");
        if (v == null || v === "") return 2000;
        const n = parseInt(v, 10);
        return Number.isNaN(n) || n < 0 ? 2000 : n;
      })(),
    },
  };
}
