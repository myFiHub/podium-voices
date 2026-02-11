# Filler clips (latency masking)

Per-persona WAV clips played before the main reply to reduce perceived TTFA.

- **Format**: 48 kHz, mono, 16-bit PCM (WAV). Match your TTS/room sample rate.
- **Layout**: `assets/fillers/<persona>/manifest.json` and `assets/fillers/<persona>/*.wav`.
- **manifest.json**: `{ "clips": [ { "id": "...", "path": "file.wav", "lengthMs": 300, "energy": "low|high", "useCase": "..." } ] }`.

If no clip file exists for an entry, the engine skips it. Add real clips to enable fillers.
