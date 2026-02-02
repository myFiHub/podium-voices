"use strict";
/**
 * OpenAI Chat Completions LLM adapter.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAILLM = void 0;
const openai_1 = __importDefault(require("openai"));
class OpenAILLM {
    cfg;
    client;
    constructor(cfg) {
        this.cfg = cfg;
        this.client = new openai_1.default({ apiKey: cfg.apiKey });
    }
    async chat(messages, options) {
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
            const chunks = [];
            const asyncIter = (async function* () {
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
exports.OpenAILLM = OpenAILLM;
//# sourceMappingURL=openai.js.map