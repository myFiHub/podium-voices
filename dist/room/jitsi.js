"use strict";
/**
 * Jitsi meeting client interface.
 * In Node we do not have a built-in Jitsi SDK; actual audio capture/publish requires
 * a browser (Jitsi Meet API) or a headless WebRTC stack. This module defines the
 * interface and a no-op stub for testing. Replace with real implementation when
 * integrating (e.g. Puppeteer + Jitsi Meet or a Node WebRTC library).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JitsiStub = void 0;
exports.createJitsiRoom = createJitsiRoom;
exports.transformIdToEmailLike = transformIdToEmailLike;
/**
 * Stub Jitsi client: no real connection. Used when testing with mock room only.
 * For real Podium integration, implement with Jitsi Meet API (browser) or Node WebRTC.
 */
class JitsiStub {
    audioCallback = null;
    constructor(_config) { }
    onIncomingAudio(callback) {
        this.audioCallback = callback;
    }
    pushAudio(buffer) {
        // No-op: no real room
        void buffer;
    }
    async leave() { }
}
exports.JitsiStub = JitsiStub;
/**
 * Create Jitsi room client. Returns JitsiBrowserBot when useJitsiBot is true; otherwise JitsiStub.
 */
function createJitsiRoom(config) {
    if (config.useJitsiBot) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { JitsiBrowserBot } = require("./jitsi-browser-bot");
        return new JitsiBrowserBot(config);
    }
    return new JitsiStub(config);
}
/**
 * Transform user UUID to email-like string for Jitsi (e.g. uuid-no-dashes@gmail.com).
 */
function transformIdToEmailLike(uuid) {
    return `${uuid.replace(/-/g, "")}@gmail.com`;
}
//# sourceMappingURL=jitsi.js.map