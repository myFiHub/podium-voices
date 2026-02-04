"use strict";
/**
 * System prompt and helpers for the AI co-host persona.
 * Persona: PodiumAI, friendly co-host; acknowledge cheers/boos; keep responses brief.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CO_HOST_SYSTEM_PROMPT = void 0;
exports.buildFeedbackLine = buildFeedbackLine;
exports.buildFeedbackContext = buildFeedbackContext;
exports.memoryToMessages = memoryToMessages;
exports.CO_HOST_SYSTEM_PROMPT = `You are "PodiumAI", an AI co-host in a live audio room.
Your role is to assist and banter with the main human host and engage the audience.
Speak in a natural, upbeat conversational style. Keep your responses concise (1-3 sentences) and on-topic.
You must not interrupt others and only speak when there is a lull or you are invited.
Acknowledge audience reactions: if the audience cheers or claps, respond with excitement or gratitude.
If the audience boos or sounds unhappy, respond with a light apology or self-deprecating humor and adjust your tone.
Always maintain a friendly, witty, and helpful demeanor.
Do not use profanity or offensive language, even if the audience does. Stay positive and helpful.`;
/**
 * Build the feedback line to inject into context (e.g. before the last user message).
 */
function buildFeedbackLine(sentiment, lastMinute) {
    if (sentiment === "cheer")
        return "Audience feedback: The audience just cheered or reacted positively.";
    if (sentiment === "boo")
        return "Audience feedback: The audience booed or reacted negatively. Adjust tone or change topic.";
    return lastMinute ? "Audience feedback: Neutral in the last minute." : "";
}
/**
 * Build richer feedback context using a derived behavior level (threshold-driven).
 * Keep this as a single short line so it behaves well as an LLM prompt hint.
 */
function buildFeedbackContext(args) {
    const level = args.behaviorLevel ?? "neutral";
    if (level === "high_positive") {
        return "Audience feedback: The room is very enthusiastic (many cheers/likes). Match the energy and lean into what’s working.";
    }
    if (level === "positive") {
        return "Audience feedback: The room seems positive. Keep the vibe upbeat and invite more participation.";
    }
    if (level === "high_negative") {
        return "Audience feedback: Strong negative reactions (boos/dislikes). De-escalate: shorten replies, change topic, or ask a question to reset.";
    }
    if (level === "negative") {
        return "Audience feedback: Some negative reactions. Adjust tone, clarify, and consider changing approach or topic.";
    }
    // Default: fall back to sentiment-only line so existing behavior stays stable.
    return buildFeedbackLine(args.sentiment, args.lastMinute);
}
/**
 * Format recent memory snapshot into messages for the LLM (excluding system).
 * Optionally prepends feedback line and running summary as context.
 */
function memoryToMessages(snapshot, feedbackLine) {
    const messages = [];
    const contextParts = [];
    if (snapshot.runningSummary) {
        contextParts.push(`[Running summary of earlier conversation: ${snapshot.runningSummary}]`);
    }
    if (feedbackLine) {
        contextParts.push(feedbackLine);
    }
    if (contextParts.length > 0) {
        messages.push({ role: "user", content: contextParts.join("\n\n") });
    }
    for (const turn of snapshot.turns) {
        if (turn.role === "user" || turn.role === "assistant") {
            messages.push({ role: turn.role, content: turn.content });
        }
    }
    return messages;
}
//# sourceMappingURL=co-host.js.map