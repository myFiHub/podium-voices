/**
 * Env-based configuration for AI co-host MVP.
 * Load from .env.local (or process.env). Do not commit secrets.
 */
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
        outpostServer: string;
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
        /** If true, generate a storyteller-style opener via LLM after join (when greetingText is empty). */
        openerEnabled?: boolean;
        /** Delay (ms) after room join before generating/speaking the opener. */
        openerDelayMs?: number;
        /** Max tokens for opener generation (LLM). */
        openerMaxTokens?: number;
        /** Optional topic seed override (env/config). */
        topicSeed?: string;
    };
}
/**
 * Build config from environment variables.
 * ASR_PROVIDER, LLM_PROVIDER, TTS_PROVIDER select adapters (openai, anthropic, google, azure, stub).
 */
export declare function loadConfig(): AppConfig;
/** Result of configuration validation: errors block correct operation, warnings indicate likely misconfiguration. */
export interface ConfigValidationResult {
    errors: string[];
    warnings: string[];
}
/**
 * Validate loaded config and env: ASR, LLM, TTS credentials and Podium settings.
 * Call after loadConfig() and log errors/warnings so operators see missing or placeholder values.
 */
export declare function validateConfig(config: AppConfig): ConfigValidationResult;
//# sourceMappingURL=index.d.ts.map