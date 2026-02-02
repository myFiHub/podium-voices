/**
 * OpenAI Chat Completions LLM adapter.
 */
import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";
export interface OpenAILlmConfig {
    apiKey: string;
    model: string;
}
export declare class OpenAILLM implements ILLM {
    private readonly cfg;
    private client;
    constructor(cfg: OpenAILlmConfig);
    chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}
//# sourceMappingURL=openai.d.ts.map