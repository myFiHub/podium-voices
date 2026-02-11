/**
 * Filler engine: chooses a short filler or backchannel to play before the main reply.
 * Reduces perceived latency (TTFA) by playing cached clips or quick TTS while the LLM generates.
 */

import * as fs from "fs";
import * as path from "path";

/** User sentiment or intent hint for filler selection. */
export type FillerSentiment = "positive" | "neutral" | "negative" | "question";

/** Choice: play a cached clip or synthesize short text. */
export type FillerChoice =
  | { type: "clip"; path: string; lengthMs?: number; energy?: string }
  | { type: "tts"; text: string; energy?: string }
  | null;

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
export function chooseFiller(
  config: FillerEngineConfig,
  personaId: string,
  options?: { sentiment?: FillerSentiment; expectedWaitMs?: number }
): FillerChoice {
  const dirName = config.personaDirs?.[personaId] ?? personaId;
  const personaDir = path.join(config.basePath, dirName);
  const manifestPath = path.join(personaDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) return null;

  let manifest: FillerManifest;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw) as FillerManifest;
  } catch {
    return null;
  }

  if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) return null;

  // Simple strategy: pick first clip (or first matching sentiment/useCase if we add filters later).
  const entry = manifest.clips[0];
  const clipPath = path.join(personaDir, entry.path);
  if (!fs.existsSync(clipPath)) return null;

  return {
    type: "clip",
    path: clipPath,
    lengthMs: entry.lengthMs,
    energy: entry.energy,
  };
}

/** Standard WAV header size (skip to get to PCM data). */
const WAV_HEADER_SIZE = 44;

/**
 * Stream filler audio from a clip file (WAV or raw PCM) in chunks.
 * If file looks like WAV (starts with "RIFF"), skips 44-byte header.
 * Yields buffers until the file is read or shouldAbort() returns true.
 */
export async function* streamFillerClip(
  clipPath: string,
  chunkSizeBytes: number = 4096,
  shouldAbort: () => boolean = () => false
): AsyncGenerator<Buffer> {
  const fd = fs.openSync(clipPath, "r");
  let offset = 0;
  try {
    const first = Buffer.alloc(4);
    if (fs.readSync(fd, first, 0, 4, 0) >= 4 && first.toString("ascii", 0, 4) === "RIFF") {
      offset = WAV_HEADER_SIZE;
    }
  } catch {
    // ignore; offset stays 0
  }
  try {
    let position = offset;
    const buf = Buffer.alloc(chunkSizeBytes);
    let n: number;
    while (!shouldAbort() && (n = fs.readSync(fd, buf, 0, chunkSizeBytes, position)) > 0) {
      position += n;
      yield n < chunkSizeBytes ? buf.subarray(0, n) : Buffer.from(buf);
    }
  } finally {
    fs.closeSync(fd);
  }
}
