import type { Message } from "../adapters/llm";
import type { SessionMemorySnapshot } from "../memory/types";
export type PromptMode = "opener" | "reply";
export interface PromptManagerConfig {
    /** Base system prompt/persona. Defaults to CO_HOST_SYSTEM_PROMPT. */
    systemPrompt?: string;
    /** Optional additional persona/style for a storyteller vibe. */
    storytellerAddendum?: string;
}
export interface BuildPromptArgs {
    mode: PromptMode;
    snapshot: SessionMemorySnapshot;
    sentiment: "cheer" | "boo" | "neutral";
    /** Topic seed for the room (env/config, outpost subject/tags, etc.). */
    topicSeed?: string;
    /** Optional extra context about the outpost (subject, tags, etc.). */
    outpostContext?: string;
}
/**
 * PromptManager
 *
 * Centralizes how we build prompts/messages for the LLM so we can evolve
 * persona, opener vs reply behaviors, and constraints without touching the orchestrator.
 */
export declare class PromptManager {
    private readonly systemPrompt;
    private readonly storytellerAddendum;
    constructor(cfg?: PromptManagerConfig);
    buildMessages(args: BuildPromptArgs): Message[];
}
//# sourceMappingURL=prompt-manager.d.ts.map