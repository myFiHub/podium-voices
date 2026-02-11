/**
 * Sentence boundary detection for LLM→TTS pipelining.
 * Flushes on sentence-ending punctuation ( . ! ? ) or newline, or when buffer exceeds max length.
 */
/** Max characters per TTS chunk when no sentence boundary is found (avoids waiting forever). */
export declare const DEFAULT_MAX_CHARS_PER_CHUNK = 250;
export interface FlushResult {
    /** Complete sentence(s) to send to TTS (trimmed, non-empty). */
    sentences: string[];
    /** Remaining buffer (incomplete). */
    remainder: string;
}
/**
 * Given the current buffer, extract complete sentences and return remainder.
 * Flushes on . ! ? (with optional trailing space) or newline, or when buffer length >= maxChars.
 */
export declare function flushSentences(buffer: string, maxChars?: number): FlushResult;
//# sourceMappingURL=sentence-splitter.d.ts.map