# CI / runner audio prerequisites (Linux)

Tier-2 E2E uses a real browser bot and real audio I/O. On a self-hosted runner, you need a **stable, deterministic audio device**.

This doc describes a conservative setup that works well on Ubuntu/Debian-based runners.

## Packages

```bash
sudo apt-get update
sudo apt-get install -y pulseaudio pulseaudio-utils alsa-utils espeak-ng
```

- `pulseaudio` / `pactl`: virtual sink/source for Chrome
- `espeak-ng`: generates deterministic speech WAV stimuli for E2E presets

## PulseAudio: create a virtual mic

Start PulseAudio if it is not already running:

```bash
pulseaudio --check || pulseaudio --start
```

Create a null sink (virtual speakers) and a virtual source (virtual mic):

```bash
pactl load-module module-null-sink sink_name=podium_e2e_sink sink_properties=device.description=podium_e2e_sink
pactl load-module module-virtual-source source_name=podium_e2e_mic master=podium_e2e_sink.monitor source_properties=device.description=podium_e2e_mic
```

Optionally set defaults:

```bash
pactl set-default-sink podium_e2e_sink
pactl set-default-source podium_e2e_mic
```

List devices (sanity check):

```bash
pactl list short sinks
pactl list short sources
```

## Chrome / Playwright notes

- Prefer running the runner with an active user session (not a minimal headless container) for audio stability.
- Ensure the environment has a functioning PulseAudio server and that Chrome can enumerate audio devices.

## Stimulus generation (speech WAV)

The `prod-whisper-local` preset uses `stimuli/hello_world.wav`. If missing, the harness will auto-generate it via:

```bash
npm run stimuli:generate
```

## Whisper-local smoke test

Before scheduling E2E, validate the ASR worker:

```bash
pip install faster-whisper
npm run whisper-local:smoke
```

