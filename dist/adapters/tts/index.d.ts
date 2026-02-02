/**
 * TTS adapter factory: returns implementation based on config.
 */
import type { AppConfig } from "../../config";
import type { ITTS } from "./types";
export type { ITTS, VoiceOptions } from "./types";
export { ttsToStream } from "./types";
export { StubTTS } from "./stub";
export { GoogleCloudTTS } from "./google-cloud";
export { AzureTTS } from "./azure";
export declare function createTTS(config: AppConfig): ITTS;
//# sourceMappingURL=index.d.ts.map