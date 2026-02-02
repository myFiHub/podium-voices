/**
 * Anthropic Claude LLM adapter.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";

export interface AnthropicLlmConfig {
  apiKey: string;
  model: string;
}

export class AnthropicLLM implements ILLM {
  private client: Anthropic;

  constructor(private readonly cfg: AnthropicLlmConfig) {
    this.client = new Anthropic({ apiKey: cfg.apiKey });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const stream = options?.stream ?? false;
    const maxTokens = options?.maxTokens ?? 256;
    const system = messages.find((m) => m.role === "system")?.content;
    const rest = messages.filter((m) => m.role !== "system");
    const msgs = rest.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    if (stream) {
      const streamResult = await this.client.messages.stream({
        model: this.cfg.model,
        max_tokens: maxTokens,
        system: system ?? undefined,
        messages: msgs,
      });
      const chunks: string[] = [];
      const asyncIter = (async function* (): AsyncIterable<string> {
        for await (const event of streamResult) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const text = event.delta.text;
            chunks.push(text);
            yield text;
          }
        }
      })();
      return { text: chunks.join(""), stream: asyncIter };
    }
    const response = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: maxTokens,
      system: system ?? undefined,
      messages: msgs,
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    return { text };
  }
}
