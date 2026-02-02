"use strict";
/**
 * Stub LLM adapter for testing or when no provider is configured.
 * Returns empty or fixed response.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StubLLM = void 0;
class StubLLM {
    async chat(_messages, _options) {
        return { text: "" };
    }
}
exports.StubLLM = StubLLM;
//# sourceMappingURL=stub.js.map