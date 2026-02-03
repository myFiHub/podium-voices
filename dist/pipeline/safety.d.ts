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
export declare class SafetyGate {
    private readonly maxUserChars;
    private readonly maxAssistantChars;
    constructor(cfg?: SafetyGateConfig);
    sanitizeUserTranscript(text: string): SafetyResult;
    sanitizeAssistantReply(text: string): SafetyResult;
}
//# sourceMappingURL=safety.d.ts.map