import type { Message } from "../adapters/llm";
import type { SessionMemorySnapshot } from "../memory/types";
import type { FeedbackBehaviorLevel, FeedbackSentiment } from "../feedback/types";
import { CO_HOST_SYSTEM_PROMPT, buildFeedbackContext, memoryToMessages } from "./co-host";

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
export class PromptManager {
  private readonly systemPrompt: string;
  private readonly storytellerAddendum: string;
  private readonly feedbackContextBuilder: FeedbackContextBuilder;

  constructor(cfg: PromptManagerConfig = {}) {
    this.systemPrompt = cfg.systemPrompt ?? CO_HOST_SYSTEM_PROMPT;
    this.storytellerAddendum = cfg.storytellerAddendum ?? [
      "When starting a new conversation, you can speak like a master storyteller: set the scene, build intrigue, and invite participation.",
      "Be vivid but concise. Avoid long monologues; include a question to pull the audience in.",
    ].join("\n");
    this.feedbackContextBuilder = cfg.feedbackContextBuilder ?? ((args) => buildFeedbackContext(args));
  }

  buildMessages(args: BuildPromptArgs): Message[] {
    const feedbackLine = this.feedbackContextBuilder({
      sentiment: args.sentiment,
      behaviorLevel: args.behaviorLevel,
      lastMinute: true,
    });
    const historyMessages = memoryToMessages(args.snapshot, feedbackLine);

    if (args.mode === "opener") {
      const topic = (args.topicSeed || "").trim();
      const outpostContext = (args.outpostContext || "").trim();
      const promptParts: string[] = [];
      if (topic) promptParts.push(`Topic seed: ${topic}`);
      if (outpostContext) promptParts.push(`Room context: ${outpostContext}`);
      promptParts.push(
        "Task: Begin the room conversation like a master storyteller. Set a vivid scene, connect it to the topic, keep it under ~20 seconds, and end with a friendly question inviting someone to respond."
      );
      return [
        { role: "system", content: [this.systemPrompt, this.storytellerAddendum].join("\n\n") },
        { role: "user", content: promptParts.join("\n") },
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
      ];
    }

    // Default: reply mode
    return [
      { role: "system", content: this.systemPrompt },
      ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
    ];
  }
}

