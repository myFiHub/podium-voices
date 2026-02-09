export interface PersonaPlexClientConfig {
    /** Base URL of the PersonaPlex server, e.g. https://localhost:8998 */
    serverUrl: string;
    /** Voice prompt filename expected by server (e.g. NATF2.pt). */
    voicePrompt: string;
    /** Allow self-signed TLS certs (dev only). */
    sslInsecure?: boolean;
    /** Optional deterministic seed. */
    seed?: number;
    /** Overall timeout for one turn (connect + stream + response). */
    turnTimeoutMs: number;
}
export interface PersonaPlexRunTurnArgs {
    /**
     * Optional stable identifier for correlating logs/metrics for a single PersonaPlex turn.
     * Typically the orchestrator's utterance id (e.g. "personaplex-...").
     */
    turnId?: string;
    /** User audio segment (mono s16le PCM) at 16 kHz. */
    userPcm16k: Buffer;
    /** Persona/role prompt (server expects leading/trailing space tags). */
    textPrompt: string;
    /** Override configured voice prompt for this turn (optional). */
    voicePrompt?: string;
    /** Override configured seed for this turn (optional). */
    seed?: number;
}
export interface PersonaPlexTurnResult {
    /** 48 kHz mono s16le PCM to inject into the room. */
    audio48k: AsyncIterable<Buffer>;
    /** Resolves to the (best-effort) text tokens emitted by the server during generation. */
    text: Promise<string>;
    /** Abort the turn early (e.g. on barge-in). */
    abort: () => void;
}
//# sourceMappingURL=types.d.ts.map