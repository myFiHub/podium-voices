/**
 * Anthropic Claude LLM adapter.
 */
import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";
export interface AnthropicLlmConfig {
    apiKey: string;
    model: string;
}
export declare class AnthropicLLM implements ILLM {
    private readonly cfg;
    private client;
    constructor(cfg: AnthropicLlmConfig);
    chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
}
//# sourceMappingURL=anthropic.d.ts.map