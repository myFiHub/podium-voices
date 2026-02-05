"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERSONAS = void 0;
exports.getPersona = getPersona;
const types_1 = require("../feedback/types");
const co_host_1 = require("./co-host");
/** Addendum for influencer/podcast-host style: warmth, rhetorical structure, candid and direct like a popular host. */
const INFLUENCER_ADDENDUM = [
    "Persona: You sound like a mix of a polished podcast host and a candid, engaging influencer.",
    "Use warmth and conviction: clear point of view, occasional emphasis or repetition for effect ('That's the thing—' or 'And that matters.').",
    "Be direct and conversational: ask real follow-up questions, react genuinely to what people say, and sometimes build to a short punchy conclusion.",
    "Vary your openings: sometimes jump straight in, sometimes acknowledge the other person first. Avoid sounding scripted or samey.",
].join(" ");
exports.PERSONAS = {
    default: {
        id: "default",
        systemPrompt: co_host_1.CO_HOST_SYSTEM_PROMPT,
        feedbackThresholds: types_1.DEFAULT_FEEDBACK_THRESHOLDS,
        // Use default feedbackContextBuilder in PromptManager (buildFeedbackContext).
    },
    hype: {
        id: "hype",
        systemPrompt: [
            co_host_1.CO_HOST_SYSTEM_PROMPT,
            "Persona addendum: You are a high-energy hype co-host. Use slightly more excitement and momentum, but stay concise.",
        ].join("\n\n"),
        feedbackThresholds: types_1.DEFAULT_FEEDBACK_THRESHOLDS,
        feedbackContextBuilder: (args) => (0, co_host_1.buildFeedbackContext)(args),
    },
    calm: {
        id: "calm",
        systemPrompt: [
            co_host_1.CO_HOST_SYSTEM_PROMPT,
            "Persona addendum: You are calm and steady. Keep responses short, grounded, and de-escalate quickly when the room turns negative.",
        ].join("\n\n"),
        // Calm persona reacts earlier to negative feedback.
        feedbackThresholds: {
            ...types_1.DEFAULT_FEEDBACK_THRESHOLDS,
            negative: { minBoos: 1, minDislikes: 2 },
            highNegative: { minBoos: 2, minDislikes: 4 },
        },
        feedbackContextBuilder: (args) => (0, co_host_1.buildFeedbackContext)(args),
    },
    /** Influencer/podcast style: natural flow, warmth, directness (e.g. Obama/Rogan, Harris/Alex Cooper vibe). */
    influencer: {
        id: "influencer",
        systemPrompt: [co_host_1.CO_HOST_SYSTEM_PROMPT, INFLUENCER_ADDENDUM].join("\n\n"),
        feedbackThresholds: types_1.DEFAULT_FEEDBACK_THRESHOLDS,
        feedbackContextBuilder: (args) => (0, co_host_1.buildFeedbackContext)(args),
    },
};
function getPersona(personaId) {
    const key = (personaId || "").trim().toLowerCase();
    return exports.PERSONAS[key] ?? exports.PERSONAS.default;
}
//# sourceMappingURL=persona.js.map