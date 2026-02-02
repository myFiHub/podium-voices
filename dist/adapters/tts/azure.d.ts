/**
 * Azure Cognitive Services Text-to-Speech adapter (optional).
 * Uses REST API with subscription key.
 */
import type { ITTS, VoiceOptions } from "./types";
export interface AzureTTSConfig {
    key: string;
    region: string;
    voiceName?: string;
}
export declare class AzureTTS implements ITTS {
    private readonly config;
    constructor(config: AzureTTSConfig);
    synthesize(text: string, options?: VoiceOptions): Promise<Buffer>;
}
//# sourceMappingURL=azure.d.ts.map