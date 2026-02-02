/**
 * Audio format helpers: PCM to WAV for ASR input.
 */

/**
 * Prepend a 44-byte WAV header to 16-bit mono PCM.
 * Sample rate typically 16000 for VAD output.
 */
export function pcmToWav(pcm: Buffer, sampleRateHz: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRateHz * numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;
  const header = Buffer.alloc(headerSize);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize - 8, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
