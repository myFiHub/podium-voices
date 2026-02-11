/**
 * Filler engine: chooses a short filler or backchannel to play before the main reply.
 * Reduces perceived latency (TTFA) by playing cached clips or quick TTS while the LLM generates.
 */
/** User sentiment or intent hint for filler selection. */
export type FillerSentiment = "positive" | "neutral" | "negative" | "question";
/** Choice: play a cached clip or synthesize short text. */
export type FillerChoice = {
    type: "clip";
    path: string;
    lengthMs?: number;
    energy?: string;
} | {
    type: "tts";
    text: string;
    energy?: string;
} | null;
/** Manifest entry for a single clip. */
export interface FillerClipEntry {
    id: string;
    /** Filename relative to persona dir (e.g. "ack.wav"). */
    path: string;
    lengthMs?: number;
    energy?: string;
    useCase?: string;
}
export interface FillerManifest {
    clips: FillerClipEntry[];
}
export interface FillerEngineConfig {
    /** Base directory for persona filler assets (e.g. assets/fillers). */
    basePath: string;
    /** Persona ID to subdir mapping; default is identity (personaId -> personaId). */
    personaDirs?: Record<string, string>;
}
/**
 * Picks a filler for the given persona and optional context.
 * Returns null if no fillers are configured or no suitable clip is found.
 */
export declare function chooseFiller(config: FillerEngineConfig, personaId: string, options?: {
    sentiment?: FillerSentiment;
    expectedWaitMs?: number;
}): FillerChoice;
/**
 * Stream filler audio from a clip file (WAV or raw PCM) in chunks.
 * If file looks like WAV (starts with "RIFF"), skips 44-byte header.
 * Yields buffers until the file is read or shouldAbort() returns true.
 */
export declare function streamFillerClip(clipPath: string, chunkSizeBytes?: number, shouldAbort?: () => boolean): AsyncGenerator<Buffer>;
//# sourceMappingURL=fillerEngine.d.ts.map