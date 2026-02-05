import type { Message } from "../adapters/llm";
import type { SessionMemorySnapshot } from "../memory/types";
import type { FeedbackBehaviorLevel, FeedbackSentiment } from "../feedback/types";
export type PromptMode = "opener" | "reply";
export type FeedbackContextBuilder = (args: {
    sentiment: FeedbackSentiment;
    behaviorLevel?: FeedbackBehaviorLevel;
    lastMinute?: boolean;
}) => string;
export interface PromptManagerConfig {
    /** Base system prompt/persona. Defaults to CO_HOST_SYSTEM_PROMPT. */
    systemPrompt?: string;
    /** Optional additional persona/style for a storyteller vibe. */
    storytellerAddendum?: string;
    /** Optional: override how feedback context is injected into the prompt. */
    feedbackContextBuilder?: FeedbackContextBuilder;
}
export interface BuildPromptArgs {
    mode: PromptMode;
    snapshot: SessionMemorySnapshot;
    sentiment: FeedbackSentiment;
    behaviorLevel?: FeedbackBehaviorLevel;
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
    private readonly feedbackContextBuilder;
    constructor(cfg?: PromptManagerConfig);
    buildMessages(args: BuildPromptArgs): Message[];
    /**
     * Build a single text prompt string for PersonaPlex.
     *
     * PersonaPlex expects a single `text_prompt` string (with system-tag spacing handled by client).
     * We keep it compact: system prompt + feedback + recent turns in a simple transcript format.
     */
    buildPersonaPlexTextPrompt(args: BuildPromptArgs): string;
}
//# sourceMappingURL=prompt-manager.d.ts.map