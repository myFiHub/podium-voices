/**
 * LLM adapter factory: returns implementation based on config.
 */

import type { AppConfig } from "../../config";
import type { ILLM } from "./types";
import { StubLLM } from "./stub";
import { OpenAILLM } from "./openai";
import { AnthropicLLM } from "./anthropic";

export type { ILLM, Message, ChatOptions, ChatResponse } from "./types";
export { StubLLM } from "./stub";
export { OpenAILLM } from "./openai";
export { AnthropicLLM } from "./anthropic";

export function createLLM(config: AppConfig): ILLM {
  const { provider, openaiApiKey, openaiModel, anthropicApiKey, anthropicModel } = config.llm;
  if (provider === "openai" && openaiApiKey) {
    return new OpenAILLM({ apiKey: openaiApiKey, model: openaiModel || "gpt-4o-mini" });
  }
  if (provider === "anthropic" && anthropicApiKey) {
    return new AnthropicLLM({ apiKey: anthropicApiKey, model: anthropicModel || "claude-3-5-sonnet-20241022" });
  }
  return new StubLLM();
}
