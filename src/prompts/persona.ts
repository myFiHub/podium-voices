import type { FeedbackThresholds } from "../feedback/types";
import { DEFAULT_FEEDBACK_THRESHOLDS } from "../feedback/types";
import type { FeedbackContextBuilder } from "./prompt-manager";
import { CO_HOST_SYSTEM_PROMPT, buildFeedbackContext } from "./co-host";

export interface Persona {
  id: string;
  systemPrompt: string;
  storytellerAddendum?: string;
  feedbackThresholds?: FeedbackThresholds;
  feedbackContextBuilder?: FeedbackContextBuilder;
}

export const PERSONAS: Record<string, Persona> = {
  default: {
    id: "default",
    systemPrompt: CO_HOST_SYSTEM_PROMPT,
    feedbackThresholds: DEFAULT_FEEDBACK_THRESHOLDS,
    // Use default feedbackContextBuilder in PromptManager (buildFeedbackContext).
  },
  hype: {
    id: "hype",
    systemPrompt: [
      CO_HOST_SYSTEM_PROMPT,
      "Persona addendum: You are a high-energy hype co-host. Use slightly more excitement and momentum, but stay concise.",
    ].join("\n\n"),
    feedbackThresholds: DEFAULT_FEEDBACK_THRESHOLDS,
    feedbackContextBuilder: (args) => buildFeedbackContext(args),
  },
  calm: {
    id: "calm",
    systemPrompt: [
      CO_HOST_SYSTEM_PROMPT,
      "Persona addendum: You are calm and steady. Keep responses short, grounded, and de-escalate quickly when the room turns negative.",
    ].join("\n\n"),
    // Calm persona reacts earlier to negative feedback.
    feedbackThresholds: {
      ...DEFAULT_FEEDBACK_THRESHOLDS,
      negative: { minBoos: 1, minDislikes: 2 },
      highNegative: { minBoos: 2, minDislikes: 4 },
    },
    feedbackContextBuilder: (args) => buildFeedbackContext(args),
  },
};

export function getPersona(personaId?: string): Persona {
  const key = (personaId || "").trim().toLowerCase();
  return PERSONAS[key] ?? PERSONAS.default;
}

