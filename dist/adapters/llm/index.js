"use strict";
/**
 * LLM adapter factory: returns implementation based on config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicLLM = exports.OpenAILLM = exports.StubLLM = void 0;
exports.createLLM = createLLM;
const stub_1 = require("./stub");
const openai_1 = require("./openai");
const anthropic_1 = require("./anthropic");
var stub_2 = require("./stub");
Object.defineProperty(exports, "StubLLM", { enumerable: true, get: function () { return stub_2.StubLLM; } });
var openai_2 = require("./openai");
Object.defineProperty(exports, "OpenAILLM", { enumerable: true, get: function () { return openai_2.OpenAILLM; } });
var anthropic_2 = require("./anthropic");
Object.defineProperty(exports, "AnthropicLLM", { enumerable: true, get: function () { return anthropic_2.AnthropicLLM; } });
function createLLM(config) {
    const { provider, openaiApiKey, openaiModel, anthropicApiKey, anthropicModel } = config.llm;
    if (provider === "openai" && openaiApiKey) {
        return new openai_1.OpenAILLM({ apiKey: openaiApiKey, model: openaiModel || "gpt-4o-mini" });
    }
    if (provider === "anthropic" && anthropicApiKey) {
        return new anthropic_1.AnthropicLLM({ apiKey: anthropicApiKey, model: anthropicModel || "claude-3-5-sonnet-20241022" });
    }
    return new stub_1.StubLLM();
}
//# sourceMappingURL=index.js.map