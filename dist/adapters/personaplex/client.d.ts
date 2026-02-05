import type { PersonaPlexClientConfig, PersonaPlexRunTurnArgs, PersonaPlexTurnResult } from "./types";
export declare class PersonaPlexClient {
    private readonly config;
    constructor(config: PersonaPlexClientConfig);
    /**
     * Run a single PersonaPlex turn.
     *
     * Contract:
     * - Input is a user utterance segment (16kHz mono s16le PCM).
     * - Output is an async iterable yielding 48kHz mono s16le PCM chunks suitable for room injection.
     * - The returned `text` is best-effort: PersonaPlex emits token pieces during generation.
     */
    runTurn(args: PersonaPlexRunTurnArgs): Promise<PersonaPlexTurnResult>;
}
//# sourceMappingURL=client.d.ts.map