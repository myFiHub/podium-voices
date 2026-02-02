/**
 * LLM adapter factory: returns implementation based on config.
 */
import type { AppConfig } from "../../config";
import type { ILLM } from "./types";
export type { ILLM, Message, ChatOptions, ChatResponse } from "./types";
export { StubLLM } from "./stub";
export { OpenAILLM } from "./openai";
export { AnthropicLLM } from "./anthropic";
export declare function createLLM(config: AppConfig): ILLM;
//# sourceMappingURL=index.d.ts.map