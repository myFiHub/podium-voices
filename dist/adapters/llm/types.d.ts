/**
 * LLM adapter types.
 * Implementations can be swapped via config (e.g. OpenAI, Anthropic, local).
 */
export interface Message {
    role: "system" | "user" | "assistant";
    content: string;
}
export interface ChatOptions {
    /** If true, response may be streamed (tokens as they arrive). */
    stream?: boolean;
    /** Max tokens to generate. */
    maxTokens?: number;
}
export interface ChatResponse {
    /** Full text of the assistant reply (for non-streaming or accumulated stream). */
    text: string;
    /** If streaming was requested, yields chunks. Otherwise empty. */
    stream?: AsyncIterable<string>;
}
/**
 * LLM adapter interface: messages in, assistant reply out.
 * Supports streaming so TTS can start on first tokens.
 */
export interface ILLM {
    /**
     * Get assistant reply for the given messages.
     * @param messages - Conversation history (system + user + assistant turns).
     * @param options - Optional stream and maxTokens.
     */
    chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}
//# sourceMappingURL=types.d.ts.map