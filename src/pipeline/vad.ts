/**
 * Voice Activity Detection: detect speech vs silence on 16kHz mono 16-bit frames.
 * Uses webrtcvad (npm 1.0.1) when available; falls back to energy-based VAD if native module fails to load.
 */

const VAD_FRAME_MS = 20;
const VAD_SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const SAMPLES_PER_FRAME = (VAD_SAMPLE_RATE * VAD_FRAME_MS) / 1000;
const FRAME_SIZE_BYTES = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE;

/** RMS threshold for energy-based fallback (16-bit PCM): below = silence. */
const ENERGY_THRESHOLD = 500;

export interface VADConfig {
  /** Silence duration (ms) to consider end of turn. */
  silenceMs: number;
  /** Aggressiveness 0-3 (webrtcvad only; 0 = least aggressive, 3 = most). */
  aggressiveness?: number;
}

export interface VADResult {
  /** True if speech detected in this frame. */
  isSpeech: boolean;
  /** True when silence has lasted >= silenceMs after speech. */
  endOfTurn: boolean;
  /** Accumulated segment (all frames since last segment start) when endOfTurn. */
  segment: Buffer | undefined;
}

interface VadImpl {
  isVoice(frame: Buffer, sampleRate: number): boolean;
}

function loadWebRtcVad(aggressiveness: number): VadImpl | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webrtcvad = require("webrtcvad");
    const vad = typeof webrtcvad === "function" ? webrtcvad() : (webrtcvad.default ? webrtcvad.default() : webrtcvad);
    if (vad && typeof vad.isVoice === "function") {
      if (typeof vad.setMode === "function") vad.setMode(aggressiveness);
      return vad as VadImpl;
    }
  } catch {
    // Native module failed (e.g. build); use energy fallback.
  }
  return null;
}

/** Simple energy-based VAD: RMS above threshold = speech. */
function isVoiceEnergy(frame: Buffer): boolean {
  if (frame.length < 2) return false;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 2) {
    const s = frame.readInt16LE(i);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / (frame.length / 2));
  return rms > ENERGY_THRESHOLD;
}

export class VAD {
  private vad: VadImpl | null = null;
  private readonly silenceFrames: number;
  private readonly aggressiveness: number;
  private buffer: Buffer[] = [];
  private silenceCount = 0;
  private hadSpeech = false;

  constructor(config: VADConfig) {
    this.silenceFrames = Math.ceil(config.silenceMs / VAD_FRAME_MS);
    this.aggressiveness = config.aggressiveness ?? 1;
    this.vad = loadWebRtcVad(this.aggressiveness);
  }

  private isVoice(frame: Buffer): boolean {
    if (this.vad) return this.vad.isVoice(frame.slice(0, FRAME_SIZE_BYTES), VAD_SAMPLE_RATE);
    return isVoiceEnergy(frame.slice(0, FRAME_SIZE_BYTES));
  }

  /**
   * Process one frame of audio (16kHz mono 16-bit, 20ms = 640 bytes).
   * Returns VAD result; when endOfTurn, segment contains the accumulated speech.
   */
  processFrame(frame: Buffer): VADResult {
    if (frame.length < FRAME_SIZE_BYTES) {
      return { isSpeech: false, endOfTurn: false, segment: undefined };
    }
    const isSpeech = this.isVoice(frame);
    if (isSpeech) {
      this.buffer.push(frame.slice(0, FRAME_SIZE_BYTES));
      this.silenceCount = 0;
      this.hadSpeech = true;
      return { isSpeech: true, endOfTurn: false, segment: undefined };
    }
    if (this.hadSpeech) {
      this.buffer.push(frame.slice(0, FRAME_SIZE_BYTES));
      this.silenceCount++;
      if (this.silenceCount >= this.silenceFrames) {
        const segment = Buffer.concat(this.buffer);
        this.buffer = [];
        this.silenceCount = 0;
        this.hadSpeech = false;
        return { isSpeech: false, endOfTurn: true, segment };
      }
    }
    return { isSpeech: false, endOfTurn: false, segment: undefined };
  }

  /**
   * Process arbitrary-length buffer; returns array of full frames processed and optional final segment.
   * Caller should pass 16kHz mono 16-bit PCM.
   */
  processBuffer(audio: Buffer): { framesProcessed: number; segment: Buffer | undefined } {
    let offset = 0;
    let segment: Buffer | undefined;
    while (offset + FRAME_SIZE_BYTES <= audio.length) {
      const result = this.processFrame(audio.subarray(offset, offset + FRAME_SIZE_BYTES));
      offset += FRAME_SIZE_BYTES;
      if (result.endOfTurn && result.segment) segment = result.segment;
    }
    return { framesProcessed: Math.floor(offset / FRAME_SIZE_BYTES), segment };
  }

  static getFrameSizeBytes(): number {
    return FRAME_SIZE_BYTES;
  }

  static getSampleRate(): number {
    return VAD_SAMPLE_RATE;
  }
}
