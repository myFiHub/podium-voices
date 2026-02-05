"use strict";
/**
 * PCM utilities (mono, signed 16-bit little-endian).
 *
 * We keep these helpers dependency-free to avoid pulling in large DSP stacks.
 * Linear resampling is sufficient for speech and keeps implementation simple.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PCM_BYTES_PER_SAMPLE = void 0;
exports.assertS16leMonoPcm = assertS16leMonoPcm;
exports.resampleS16leMonoLinear = resampleS16leMonoLinear;
exports.padWithSilence = padWithSilence;
exports.chunkPcmByBytes = chunkPcmByBytes;
exports.PCM_BYTES_PER_SAMPLE = 2;
function assertS16leMonoPcm(buffer, label) {
    if (buffer.length % exports.PCM_BYTES_PER_SAMPLE !== 0) {
        throw new Error(`${label}: PCM buffer length must be even (s16le). Got ${buffer.length} bytes.`);
    }
}
function clampInt16(x) {
    if (x > 32767)
        return 32767;
    if (x < -32768)
        return -32768;
    return x | 0;
}
/**
 * Resample mono s16le PCM using linear interpolation.
 *
 * - Input/output are raw PCM bytes (s16le).
 * - This is intentionally simple; if we ever need higher quality, we can swap the implementation
 *   behind this function without touching call sites.
 */
function resampleS16leMonoLinear(pcm, fromRateHz, toRateHz) {
    assertS16leMonoPcm(pcm, "resampleS16leMonoLinear");
    if (fromRateHz <= 0 || toRateHz <= 0)
        throw new Error("Sample rates must be positive.");
    if (fromRateHz === toRateHz)
        return pcm;
    const inSamples = pcm.length / exports.PCM_BYTES_PER_SAMPLE;
    if (inSamples === 0)
        return Buffer.alloc(0);
    const ratio = toRateHz / fromRateHz;
    const outSamples = Math.max(1, Math.floor(inSamples * ratio));
    const out = Buffer.alloc(outSamples * exports.PCM_BYTES_PER_SAMPLE);
    for (let i = 0; i < outSamples; i++) {
        const srcPos = i / ratio; // position in input sample space
        const idx0 = Math.floor(srcPos);
        const idx1 = Math.min(idx0 + 1, inSamples - 1);
        const frac = srcPos - idx0;
        const s0 = pcm.readInt16LE(idx0 * 2);
        const s1 = pcm.readInt16LE(idx1 * 2);
        const v = s0 * (1 - frac) + s1 * frac;
        out.writeInt16LE(clampInt16(Math.round(v)), i * 2);
    }
    return out;
}
/** Pad with zeros (silence) to reach a whole number of bytes. */
function padWithSilence(pcm, targetByteLength) {
    if (pcm.length >= targetByteLength)
        return pcm;
    const out = Buffer.alloc(targetByteLength);
    pcm.copy(out, 0);
    return out;
}
/**
 * Split PCM into fixed byte-sized frames.
 * Any remainder is returned as `tail` (caller can pad/drop).
 */
function chunkPcmByBytes(pcm, frameBytes) {
    assertS16leMonoPcm(pcm, "chunkPcmByBytes");
    if (frameBytes <= 0)
        throw new Error("frameBytes must be positive.");
    const frames = [];
    let offset = 0;
    while (offset + frameBytes <= pcm.length) {
        frames.push(pcm.subarray(offset, offset + frameBytes));
        offset += frameBytes;
    }
    return { frames, tail: pcm.subarray(offset) };
}
//# sourceMappingURL=pcm-utils.js.map