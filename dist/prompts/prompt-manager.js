"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptManager = void 0;
const co_host_1 = require("./co-host");
/**
 * PromptManager
 *
 * Centralizes how we build prompts/messages for the LLM so we can evolve
 * persona, opener vs reply behaviors, and constraints without touching the orchestrator.
 */
class PromptManager {
    systemPrompt;
    storytellerAddendum;
    feedbackContextBuilder;
    constructor(cfg = {}) {
        this.systemPrompt = cfg.systemPrompt ?? co_host_1.CO_HOST_SYSTEM_PROMPT;
        this.storytellerAddendum = cfg.storytellerAddendum ?? [
            "When starting a new conversation, you can speak like a master storyteller: set the scene, build intrigue, and invite participation.",
            "Be vivid but concise. Avoid long monologues; include a question to pull the audience in.",
        ].join("\n");
        this.feedbackContextBuilder = cfg.feedbackContextBuilder ?? ((args) => (0, co_host_1.buildFeedbackContext)(args));
    }
    buildMessages(args) {
        const feedbackLine = this.feedbackContextBuilder({
            sentiment: args.sentiment,
            behaviorLevel: args.behaviorLevel,
            lastMinute: true,
        });
        const historyMessages = (0, co_host_1.memoryToMessages)(args.snapshot, feedbackLine);
        if (args.mode === "opener") {
            const topic = (args.topicSeed || "").trim();
            const outpostContext = (args.outpostContext || "").trim();
            const promptParts = [];
            if (topic)
                promptParts.push(`Topic seed: ${topic}`);
            if (outpostContext)
                promptParts.push(`Room context: ${outpostContext}`);
            promptParts.push("Task: Begin the room conversation like a master storyteller. Set a vivid scene, connect it to the topic, keep it under ~20 seconds, and end with a friendly question inviting someone to respond.");
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
    /**
     * Build a single text prompt string for PersonaPlex.
     *
     * PersonaPlex expects a single `text_prompt` string (with system-tag spacing handled by client).
     * We keep it compact: system prompt + feedback + recent turns in a simple transcript format.
     */
    buildPersonaPlexTextPrompt(args) {
        const feedbackLine = this.feedbackContextBuilder({
            sentiment: args.sentiment,
            behaviorLevel: args.behaviorLevel,
            lastMinute: true,
        });
        const lines = [];
        if (args.mode === "opener") {
            const topic = (args.topicSeed || "").trim();
            const outpostContext = (args.outpostContext || "").trim();
            if (topic)
                lines.push(`Topic seed: ${topic}`);
            if (outpostContext)
                lines.push(`Room context: ${outpostContext}`);
            lines.push("Task: Begin the room conversation like a master storyteller. Set a vivid scene, connect it to the topic, keep it under ~20 seconds, and end with a friendly question inviting someone to respond.");
            return [
                [this.systemPrompt, this.storytellerAddendum].join("\n\n"),
                feedbackLine,
                // Keep any prior conversation context if present.
                ...args.snapshot.turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`),
                lines.join("\n"),
            ]
                .filter(Boolean)
                .join("\n\n");
        }
        // reply mode
        return [
            this.systemPrompt,
            feedbackLine,
            ...args.snapshot.turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`),
        ]
            .filter(Boolean)
            .join("\n\n");
    }
}
exports.PromptManager = PromptManager;
//# sourceMappingURL=prompt-manager.js.map