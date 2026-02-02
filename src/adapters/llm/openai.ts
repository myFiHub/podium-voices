/**
 * OpenAI Chat Completions LLM adapter.
 */

import OpenAI from "openai";
import type { ILLM, Message, ChatOptions, ChatResponse } from "./types";

export interface OpenAILlmConfig {
  apiKey: string;
  model: string;
}

export class OpenAILLM implements ILLM {
  private client: OpenAI;

  constructor(private readonly cfg: OpenAILlmConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const stream = options?.stream ?? false;
    const maxTokens = options?.maxTokens ?? 256;
    const body = {
      model: this.cfg.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      stream,
    };
    if (stream) {
      const streamResult = await this.client.chat.completions.create({
        ...body,
        stream: true,
      });
      const chunks: string[] = [];
      const asyncIter = (async function* (): AsyncIterable<string> {
        for await (const chunk of streamResult) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            chunks.push(delta);
            yield delta;
          }
        }
      })();
      return { text: "", stream: asyncIter };
    }
    const response = await this.client.chat.completions.create({
      ...body,
      stream: false,
    });
    const text = response.choices[0]?.message?.content ?? "";
    return { text };
  }
}
