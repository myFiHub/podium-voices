/**
 * Node↔browser audio bridge protocol (plan: 48kHz mono s16le, 20ms frames).
 * Resampling is done only at boundaries: 48k on wire; 16k for VAD/ASR in Node.
 *
 * Wire format (browser ↔ Node):
 * - 48kHz mono 16-bit PCM (s16le), 20ms frames = 960 samples = 1920 bytes per frame.
 * - Browser→Node (rx): browser mixes all remote audio tracks (excluding bot participant), emits 20ms frames; Node resamples 48k→16k only at ASR boundary.
 * - Node→Browser (tx): Node sends 20ms 48k frames; browser jitter buffer (drop if depth > threshold), inject as synthetic mic.
 * - Jitter/backpressure: browser maintains small jitter buffer for mic injection; drop oldest frames when buffer depth exceeds threshold (prefer glitch over multi-second delay).
 */
/** Wire format: 48kHz mono 16-bit PCM. */
export declare const BRIDGE_SAMPLE_RATE = 48000;
/** Frame duration in ms (stable for VAD and timing). */
export declare const BRIDGE_FRAME_MS = 20;
/** Samples per frame at 48kHz: 960. */
export declare const BRIDGE_SAMPLES_PER_FRAME: number;
/** Bytes per frame: 960 * 2 = 1920. */
export declare const BRIDGE_FRAME_BYTES: number;
/** VAD/ASR pipeline expects 16kHz. */
export declare const VAD_SAMPLE_RATE = 16000;
/** 20ms at 16kHz = 320 samples = 640 bytes. */
export declare const VAD_FRAME_BYTES: number;
/**
 * Downsample 48kHz mono 16-bit PCM to 16kHz (take every 3rd sample).
 * Input length must be multiple of 2 (16-bit). Output length = input/3 (approx).
 */
export declare function resample48kTo16k(pcm48: Buffer): Buffer;
/**
 * Chunk a buffer into 20ms frames at 48kHz (1920 bytes per frame).
 * Returns array of frames; remainder is dropped (caller can buffer).
 */
export declare function chunk48k20ms(pcm48: Buffer): Buffer[];
//# sourceMappingURL=audio-bridge-protocol.d.ts.map