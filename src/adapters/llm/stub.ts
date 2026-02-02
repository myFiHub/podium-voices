/**
 * Stub LLM adapter for testing or when no provider is configured.
 * Returns empty or fixed response.
 */

import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";

export class StubLLM implements ILLM {
  async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    return { text: "" };
  }
}
