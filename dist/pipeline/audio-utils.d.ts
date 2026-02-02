/**
 * Audio format helpers: PCM to WAV for ASR input.
 */
/**
 * Prepend a 44-byte WAV header to 16-bit mono PCM.
 * Sample rate typically 16000 for VAD output.
 */
export declare function pcmToWav(pcm: Buffer, sampleRateHz: number): Buffer;
//# sourceMappingURL=audio-utils.d.ts.map