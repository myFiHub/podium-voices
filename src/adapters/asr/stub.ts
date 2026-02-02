/**
 * Stub ASR adapter for testing or when no provider is configured.
 * Returns empty transcript.
 */

import type { IASR, TranscriptResult } from "./types";

export class StubASR implements IASR {
  async transcribe(_audioBuffer: Buffer, _format?: string): Promise<TranscriptResult> {
    return { text: "" };
  }
}
