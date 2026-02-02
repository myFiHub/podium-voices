/**
 * Stub LLM adapter for testing or when no provider is configured.
 * Returns empty or fixed response.
 */
import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";
export declare class StubLLM implements ILLM {
    chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse>;
}
//# sourceMappingURL=stub.d.ts.map