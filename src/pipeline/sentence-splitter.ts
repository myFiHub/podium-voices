/**
 * Sentence boundary detection for LLM→TTS pipelining.
 * Flushes on sentence-ending punctuation ( . ! ? ) or newline, or when buffer exceeds max length.
 */

/** Max characters per TTS chunk when no sentence boundary is found (avoids waiting forever). */
export const DEFAULT_MAX_CHARS_PER_CHUNK = 250;

/** Sentence-ending punctuation followed by optional space or end. */
const SENTENCE_END = /[.!?]\s*|\n/g;

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
export function flushSentences(
  buffer: string,
  maxChars: number = DEFAULT_MAX_CHARS_PER_CHUNK
): FlushResult {
  const trimmed = buffer.trim();
  if (trimmed.length === 0) return { sentences: [], remainder: "" };

  if (trimmed.length >= maxChars) {
    const chunk = trimmed.slice(0, maxChars);
    const lastSpace = chunk.lastIndexOf(" ");
    const cut = lastSpace > chunk.length / 2 ? lastSpace + 1 : maxChars;
    return {
      sentences: [chunk.slice(0, cut).trim()].filter(Boolean),
      remainder: trimmed.slice(cut),
    };
  }

  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(trimmed)) !== null) {
    const sentence = trimmed.slice(lastIndex, match.index + match[0].length);
    if (sentence.trim().length > 0) sentences.push(sentence);
    lastIndex = SENTENCE_END.lastIndex;
  }
  const remainder = trimmed.slice(lastIndex);
  return { sentences, remainder };
}
