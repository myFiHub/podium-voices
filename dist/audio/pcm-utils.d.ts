/**
 * PCM utilities (mono, signed 16-bit little-endian).
 *
 * We keep these helpers dependency-free to avoid pulling in large DSP stacks.
 * Linear resampling is sufficient for speech and keeps implementation simple.
 */
export declare const PCM_BYTES_PER_SAMPLE = 2;
export declare function assertS16leMonoPcm(buffer: Buffer, label: string): void;
/**
 * Resample mono s16le PCM using linear interpolation.
 *
 * - Input/output are raw PCM bytes (s16le).
 * - This is intentionally simple; if we ever need higher quality, we can swap the implementation
 *   behind this function without touching call sites.
 */
export declare function resampleS16leMonoLinear(pcm: Buffer, fromRateHz: number, toRateHz: number): Buffer;
/** Pad with zeros (silence) to reach a whole number of bytes. */
export declare function padWithSilence(pcm: Buffer, targetByteLength: number): Buffer;
/**
 * Split PCM into fixed byte-sized frames.
 * Any remainder is returned as `tail` (caller can pad/drop).
 */
export declare function chunkPcmByBytes(pcm: Buffer, frameBytes: number): {
    frames: Buffer[];
    tail: Buffer;
};
//# sourceMappingURL=pcm-utils.d.ts.map