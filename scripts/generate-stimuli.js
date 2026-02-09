#!/usr/bin/env node
/**
 * Generate deterministic speech WAV stimuli for E2E.
 *
 * We intentionally generate these at runtime (instead of committing binary WAVs):
 * - keeps repo small and diff-friendly
 * - allows runner-specific audio toolchain to be validated explicitly
 *
 * Output (repo-root-relative):
 *   stimuli/hello_world.wav
 *   stimuli/hello_world_noisy.wav
 *
 * Dependencies on the runner:
 * - `espeak-ng` (or `espeak`) to synthesize speech to WAV
 *
 * Noisy variant is generated in pure Node by injecting deterministic noise into PCM16 data.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "stimuli");

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

function which(cmd) {
  const r = spawnSync("bash", ["-lc", `command -v ${cmd} >/dev/null 2>&1 && echo OK || echo NO`], { encoding: "utf8" });
  return (r.stdout || "").includes("OK");
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function readWavPcm16Mono(wav) {
  if (wav.length < 44) throw new Error("WAV too small");
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not RIFF/WAVE");
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt " && body + 16 <= wav.length) {
      const audioFormat = wav.readUInt16LE(body);
      const channels = wav.readUInt16LE(body + 2);
      const sampleRateHz = wav.readUInt32LE(body + 4);
      const bitsPerSample = wav.readUInt16LE(body + 14);
      fmt = { audioFormat, channels, sampleRateHz, bitsPerSample };
    } else if (id === "data") {
      dataOffset = body;
      dataSize = Math.min(size, wav.length - body);
      break;
    }
    off = body + size + (size % 2);
  }
  if (!fmt) throw new Error("WAV missing fmt chunk");
  if (dataOffset < 0) throw new Error("WAV missing data chunk");
  if (fmt.audioFormat !== 1) throw new Error(`WAV audioFormat=${fmt.audioFormat} unsupported (need PCM)`);
  if (fmt.bitsPerSample !== 16) throw new Error(`WAV bitsPerSample=${fmt.bitsPerSample} unsupported (need 16)`);
  if (fmt.channels < 1) throw new Error(`WAV invalid channels=${fmt.channels}`);
  const pcm = wav.subarray(dataOffset, dataOffset + dataSize);
  if (pcm.length % 2 !== 0) throw new Error("WAV PCM length must be even");

  // Downmix to mono if needed (simple average of channels).
  if (fmt.channels === 1) return { pcmMono: Buffer.from(pcm), sampleRateHz: fmt.sampleRateHz };
  const frames = Math.floor((pcm.length / 2) / fmt.channels);
  const out = Buffer.alloc(frames * 2);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      sum += pcm.readInt16LE((f * fmt.channels + c) * 2);
    }
    const avg = Math.max(-32768, Math.min(32767, Math.round(sum / fmt.channels)));
    out.writeInt16LE(avg, f * 2);
  }
  return { pcmMono: out, sampleRateHz: fmt.sampleRateHz };
}

function writeWavPcm16Mono(pcmMono, sampleRateHz) {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;
  const dataSize = pcmMono.length;

  // Minimal RIFF/WAVE with fmt + data chunks.
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, 4, "ascii");
  header.write("fmt ", 12, 4, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, 4, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmMono]);
}

function xorshift32(seed) {
  let x = seed >>> 0;
  return () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

function addDeterministicNoisePcm16(pcmMono, noiseGain /* 0..1 */, seed) {
  const rng = xorshift32(seed);
  const out = Buffer.from(pcmMono);
  const gain = Math.max(0, Math.min(1, noiseGain));
  const amp = Math.floor(gain * 32767);
  for (let off = 0; off + 2 <= out.length; off += 2) {
    const s = out.readInt16LE(off);
    // Uniform-ish noise in [-amp, +amp]
    const r = rng() & 0xffff;
    const n = ((r / 65535) * 2 - 1) * amp;
    const mixed = Math.max(-32768, Math.min(32767, Math.round(s + n)));
    out.writeInt16LE(mixed, off);
  }
  return out;
}

function main() {
  ensureDir(outDir);
  const cleanPath = path.join(outDir, "hello_world.wav");
  const noisyPath = path.join(outDir, "hello_world_noisy.wav");

  // Prefer espeak-ng; fall back to espeak if present.
  const hasEspeakNg = which("espeak-ng");
  const hasEspeak = which("espeak");
  const ttsCmd = hasEspeakNg ? "espeak-ng" : hasEspeak ? "espeak" : null;
  if (!ttsCmd) {
    die("generate-stimuli: missing dependency. Install `espeak-ng` (recommended) or `espeak` to generate speech WAV stimuli.");
  }

  // Generate clean WAV only if missing; keep deterministic text/voice settings.
  if (!fs.existsSync(cleanPath)) {
    console.log(`generate-stimuli: generating ${path.relative(repoRoot, cleanPath)} using ${ttsCmd}`);
    const r = spawnSync(ttsCmd, ["-v", "en-us", "-s", "160", "-w", cleanPath, "hello world"], { stdio: "inherit" });
    if (r.status !== 0) die(`generate-stimuli: ${ttsCmd} failed (exit ${r.status})`);
  } else {
    console.log(`generate-stimuli: already exists: ${path.relative(repoRoot, cleanPath)}`);
  }

  // Generate noisy variant (deterministic) only if missing.
  if (!fs.existsSync(noisyPath)) {
    console.log(`generate-stimuli: generating ${path.relative(repoRoot, noisyPath)} (deterministic noise)`);
    const wav = fs.readFileSync(cleanPath);
    const { pcmMono, sampleRateHz } = readWavPcm16Mono(wav);
    const noisyPcm = addDeterministicNoisePcm16(pcmMono, 0.02, 0xC0FFEE);
    const noisyWav = writeWavPcm16Mono(noisyPcm, sampleRateHz);
    fs.writeFileSync(noisyPath, noisyWav);
  } else {
    console.log(`generate-stimuli: already exists: ${path.relative(repoRoot, noisyPath)}`);
  }

  console.log("generate-stimuli: done");
}

main();

