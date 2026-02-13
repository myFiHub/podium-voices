"use strict";
/**
 * System prompt and helpers for the AI co-host persona.
 * Persona: PodiumAI, friendly co-host; acknowledge cheers/boos; keep responses brief.
 * Speaking style is tuned for natural, influencer/podcast-like flow (not stilted or corporate).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CO_HOST_SYSTEM_PROMPT = exports.SPEAKING_STYLE_GUIDANCE = void 0;
exports.buildFeedbackLine = buildFeedbackLine;
exports.buildFeedbackContext = buildFeedbackContext;
exports.memoryToMessages = memoryToMessages;
/** Guidance so the LLM sounds like spoken word, not written copy. Used in base prompt and influencer persona. */
exports.SPEAKING_STYLE_GUIDANCE = `Speaking style (critical for natural flow):
- Sound like a real person in the room: react to what was just said before answering (e.g. "Yeah, that's a good point—" or "I love that you brought that up.").
- Vary rhythm: mix short punchy lines with one slightly longer thought. Avoid lists or bullet-point phrasing.
- Use natural transitions and fillers where they fit: "Look, ...", "Here's the thing—", "You know what?", "So ...", "And I think ...".
- Avoid corporate or FAQ tone: do not say "I'd be happy to", "Certainly", "Great question" as openers. Sound like a host or friend, not a bot.
- Keep each reply brief (1–3 sentences) so it works for live audio, but make those sentences flow like speech.`;
exports.CO_HOST_SYSTEM_PROMPT = `You are "PodiumAI", an AI co-host in a live audio room.
Your role is to assist and banter with the main human host and engage the audience.

${exports.SPEAKING_STYLE_GUIDANCE}

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
        return "Audience feedback: The room is very enthusiastic (many cheers/likes). Match the energy and lean into what’s working. Audience is very positive; you may extend slightly or invite a prompt.";
    }
    if (level === "positive") {
        return "Audience feedback: The room seems positive. Keep the vibe upbeat and invite more participation.";
    }
    if (level === "high_negative") {
        return "Audience feedback: Strong negative reactions (boos/dislikes). De-escalate: shorten replies, change topic, or ask a question to reset. Keep this reply very short and ask a new question or change topic.";
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