/**
 * Unit tests for sentence splitter (LLM→TTS pipelining).
 */

import { flushSentences, DEFAULT_MAX_CHARS_PER_CHUNK } from "../../../src/pipeline/sentence-splitter";

describe("flushSentences", () => {
  it("returns empty when buffer is empty or whitespace", () => {
    expect(flushSentences("")).toEqual({ sentences: [], remainder: "" });
    expect(flushSentences("   ")).toEqual({ sentences: [], remainder: "" });
  });

  it("splits on period, exclamation, question mark", () => {
    const r = flushSentences("Hello. How are you?");
    expect(r.sentences).toEqual(["Hello. ", "How are you?"]);
    expect(r.remainder).toBe("");
  });

  it("splits on newline", () => {
    const r = flushSentences("Line one.\nLine two.");
    expect(r.sentences).toEqual(["Line one.\n", "Line two."]);
    expect(r.remainder).toBe("");
  });

  it("returns remainder when no sentence end", () => {
    const r = flushSentences("No period here");
    expect(r.sentences).toEqual([]);
    expect(r.remainder).toBe("No period here");
  });

  it("flushes at max chars when no boundary", () => {
    const long = "a".repeat(300);
    const r = flushSentences(long, DEFAULT_MAX_CHARS_PER_CHUNK);
    expect(r.sentences.length).toBe(1);
    expect(r.sentences[0].length).toBeLessThanOrEqual(250);
    expect(r.remainder.length).toBeGreaterThan(0);
  });

  it("preserves trailing space after punctuation for fullText", () => {
    const r = flushSentences("Hi. Bye.");
    expect(r.sentences).toEqual(["Hi. ", "Bye."]);
    expect(r.remainder).toBe("");
  });
});
