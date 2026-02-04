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
}
//# sourceMappingURL=prompt-manager.d.ts.map