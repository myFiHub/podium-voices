"use strict";
/**
 * Anthropic Claude LLM adapter.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicLLM = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class AnthropicLLM {
    cfg;
    client;
    constructor(cfg) {
        this.cfg = cfg;
        this.client = new sdk_1.default({ apiKey: cfg.apiKey });
    }
    async chat(messages, options) {
        const stream = options?.stream ?? false;
        const maxTokens = options?.maxTokens ?? 256;
        const system = messages.find((m) => m.role === "system")?.content;
        const rest = messages.filter((m) => m.role !== "system");
        const msgs = rest.map((m) => ({ role: m.role, content: m.content }));
        if (stream) {
            const streamResult = await this.client.messages.stream({
                model: this.cfg.model,
                max_tokens: maxTokens,
                system: system ?? undefined,
                messages: msgs,
            });
            const chunks = [];
            const asyncIter = (async function* () {
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
exports.AnthropicLLM = AnthropicLLM;
//# sourceMappingURL=anthropic.js.map