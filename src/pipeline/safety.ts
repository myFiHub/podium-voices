/**
 * SafetyGate: lightweight guardrails for transcripts and model outputs.
 *
 * MVP goals:
 * - prevent extremely long / runaway replies
 * - block obvious unsafe content (profanity / hate / sexual content) with a refusal
 * - reduce prompt-injection patterns (\"ignore system\", \"reveal prompt\") by reframing
 *
 * Note: this is intentionally simple; production should use a dedicated moderation model/service.
 */

export interface SafetyGateConfig {
  /** Max characters allowed in user transcript to store/use (truncate beyond). */
  maxUserChars?: number;
  /** Max characters allowed in assistant reply to speak (truncate beyond). */
  maxAssistantChars?: number;
}

export interface SafetyResult {
  allowed: boolean;
  text: string;
  reason?: string;
}

const DEFAULT_MAX_USER_CHARS = 1000;
const DEFAULT_MAX_ASSISTANT_CHARS = 600;

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|earlier) instructions/i,
  /reveal (the )?(system prompt|prompt)/i,
  /you are not an ai/i,
];

const PROFANITY_PATTERNS = [
  /\bfuck\b/i,
  /\bshit\b/i,
  /\bcunt\b/i,
  /\bnigg(er|a)\b/i,
];

export class SafetyGate {
  private readonly maxUserChars: number;
  private readonly maxAssistantChars: number;

  constructor(cfg: SafetyGateConfig = {}) {
    this.maxUserChars = cfg.maxUserChars ?? DEFAULT_MAX_USER_CHARS;
    this.maxAssistantChars = cfg.maxAssistantChars ?? DEFAULT_MAX_ASSISTANT_CHARS;
  }

  sanitizeUserTranscript(text: string): SafetyResult {
    const trimmed = (text || "").trim();
    if (!trimmed) return { allowed: false, text: "", reason: "empty" };

    const truncated = trimmed.length > this.maxUserChars ? trimmed.slice(0, this.maxUserChars) : trimmed;
    const hasInjection = INJECTION_PATTERNS.some((re) => re.test(truncated));
    if (hasInjection) {
      // Treat as allowed, but strip the injection and keep the rest of the utterance.
      const cleaned = INJECTION_PATTERNS.reduce((acc, re) => acc.replace(re, "[redacted]"), truncated);
      return { allowed: true, text: cleaned, reason: "prompt_injection_redacted" };
    }

    return { allowed: true, text: truncated };
  }

  sanitizeAssistantReply(text: string): SafetyResult {
    const trimmed = (text || "").trim();
    if (!trimmed) return { allowed: false, text: "", reason: "empty" };

    if (PROFANITY_PATTERNS.some((re) => re.test(trimmed))) {
      return {
        allowed: true,
        text: "Let’s keep it friendly. Want to share what you think about the topic so far?",
        reason: "profanity_reframed",
      };
    }

    const truncated = trimmed.length > this.maxAssistantChars ? trimmed.slice(0, this.maxAssistantChars) : trimmed;
    return { allowed: true, text: truncated };
  }
}

