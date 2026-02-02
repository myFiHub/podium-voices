/**
 * Stub ASR adapter for testing or when no provider is configured.
 * Returns empty transcript.
 */
import type { IASR, TranscriptResult } from "./types";
export declare class StubASR implements IASR {
    transcribe(_audioBuffer: Buffer, _format?: string): Promise<TranscriptResult>;
}
//# sourceMappingURL=stub.d.ts.map