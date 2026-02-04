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
}
exports.PromptManager = PromptManager;
//# sourceMappingURL=prompt-manager.js.map