# PersonaPlex (NVIDIA) Setup and Integration Notes

This repo can optionally use **PersonaPlex** as a speech-to-speech backend (instead of the default ASR → LLM → TTS chain). For a concise comparison of **standard (ASR→LLM→TTS)** vs **PersonaPlex** and how to use them in single- or multi-agent setups (including mix-and-match), see the [Conversation backends](../README.md#conversation-backends) section in the main [README](../README.md).

PersonaPlex is provided by NVIDIA under MIT (code) + NVIDIA Open Model license (weights). You must accept the model license on Hugging Face before the server can download weights.

## What you run

- **PersonaPlex server (Python)**: Runs the model and exposes a WebSocket streaming API at `/api/chat`.
- **podium-voices (Node/TypeScript)**: Connects to the PersonaPlex server, streams user audio to it, and streams bot audio back into the room.

## Prerequisites

- **Hugging Face token**: Accept the PersonaPlex model license at `https://huggingface.co/nvidia/personaplex-7b-v1` then create an access token.
  - Export it as `HF_TOKEN` before starting the server.
- **Opus development library** (required by PersonaPlex/Moshi for Opus streaming):

```bash
# Ubuntu/Debian
sudo apt install libopus-dev

# Fedora/RHEL
sudo dnf install opus-devel

# macOS
brew install opus
```

## Install PersonaPlex (self-hosted)

Clone the upstream repo and install the Moshi package contained within it:

```bash
git clone https://github.com/NVIDIA/personaplex
cd personaplex
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install moshi/.
```

### GPU / CUDA (optional)

If you are using a CUDA-enabled NVIDIA GPU, install the appropriate PyTorch build for your system. The upstream repo notes an extra step for some GPU families (see upstream docs/issues).

### CPU offload (optional)

If your GPU memory is insufficient, you can offload layers to CPU:

```bash
pip install accelerate
```

## Run PersonaPlex server

### Option A: Use the run script (recommended)

From the **podium-voices** repo root run: `bash scripts/run-personaplex-server.sh`. The script sets the HF cache to `/mnt/d/hf_cache`, loads `HF_TOKEN` from `.env.local`, and starts the server on port 8998. It expects PersonaPlex at `/mnt/d/personaplex` (override with `PERSONAPLEX_DIR` or `HF_CACHE` if needed).

### Option A1: Single instance (single-brain E2E, one bot uses PersonaPlex)

If your machine can only run **one** PersonaPlex instance, use the **single-brain** preset: Bot A injects stimulus (stub pipeline), Bot B (Jamie) uses PersonaPlex.

1. Start **one** PersonaPlex instance on port 8998:

```bash
# From podium-voices repo root
npm run personaplex:up -- --instances 1 --base-port 8998
npm run personaplex:status
```

2. Run the production E2E with the single-brain preset and point Jamie at that instance:

```bash
E2E_PRESET=prod-personaplex-singlebrain E2E_BOT_B_PERSONAPLEX_URL=https://localhost:8998 node scripts/e2e-two-bot.js
```

If `PERSONAPLEX_SERVER_URL` in `.env.local` is already `https://localhost:8998`, you can omit `E2E_BOT_B_PERSONAPLEX_URL`; the script will use the default. To stop the instance: `npm run personaplex:down`.

The single-brain preset uses **degraded** PersonaPlex failure policy and does **not** require the receive gate (RECV_GATE). So the run does not abort on recv timeout or PersonaPlex failure: if PersonaPlex fails (e.g. no audio), the run continues and with `PERSONAPLEX_FALLBACK_TO_LLM=true` (and ASR/LLM/TTS configured) the bot falls back to ASR→LLM→TTS; when the fallback produces a reply, the E2E run passes (all gates passed).

### Option A1b: One PersonaPlex + one ASR→LLM→TTS (prod-personaplex-pipeline)

Bot A (Alex) uses **real ASR→LLM→TTS** (OpenAI + Google TTS); Bot B (Jamie) uses **PersonaPlex**. One PersonaPlex instance is enough. Use this for testing a mixed pipeline + PersonaPlex conversation.

**Prerequisites:** `OPENAI_API_KEY` and Google TTS in `.env.local`; `HF_TOKEN` and PersonaPlex for the PersonaPlex bot.

1. Start one PersonaPlex instance:

```bash
# From podium-voices repo root
npm run personaplex:up -- --instances 1 --base-port 8998
npm run personaplex:status
```

2. Run E2E with the pipeline preset (Jamie = PersonaPlex, point at the instance):

```bash
E2E_PRESET=prod-personaplex-pipeline E2E_BOT_B_PERSONAPLEX_URL=https://localhost:8998 node scripts/e2e-two-bot.js
```

To stop PersonaPlex: `npm run personaplex:down`.

### Option A2: Supervised multi-instance (dual-brain E2E, both bots use PersonaPlex)

PersonaPlex behaves like a single-capacity worker. For two-bot E2E (or multiple bots), run **one PersonaPlex instance per bot**.

**Prerequisites before running:** `HF_TOKEN` in `.env.local`, PersonaPlex cloned at `PERSONAPLEX_DIR` (default `/mnt/d/personaplex`), and `libopus-dev` installed (`sudo apt install libopus-dev` on Ubuntu/Debian). The supervisor auto-detects a Python that can run `moshi.server`: it tries the venv first, then falls back to system `python3` if the venv does not have the moshi package installed. To use the venv, install moshi from the PersonaPlex repo: `cd PERSONAPLEX_DIR && .venv/bin/pip install ./moshi`.

```bash
# From podium-voices repo root
npm run personaplex:up -- --instances 2 --base-port 8998
npm run personaplex:status
```

This starts instances on:

- `https://localhost:8998`
- `https://localhost:8999`

The supervisor writes PID + metadata into `logs/pids/` and captures server stdout/stderr into `logs/personaplex/`.

To stop instances:

```bash
npm run personaplex:down
```

### Option B: Manual export and launch

1) Export your Hugging Face token so the server can download the gated model. Either:

   - **If you use podium-voices’ `.env.local`**: it can hold `HF_TOKEN=...` (or `HUGGINGFACE_API_KEY=...`; the server expects `HF_TOKEN`). From the **podium-voices** repo root, run:
     ```bash
     set -a && source .env.local && set +a
     python -m moshi.server ...
     ```
   - **Or export in the shell** before starting the server:
     ```bash
     export HF_TOKEN="<your_huggingface_token>"
     ```

2) Launch the server.

The upstream server can auto-generate a temporary SSL cert directory for HTTPS:

```bash
SSL_DIR=$(mktemp -d)
python -m moshi.server --ssl "$SSL_DIR" --host 0.0.0.0 --port 8998
```

If you need CPU offload:

```bash
SSL_DIR=$(mktemp -d)
python -m moshi.server --ssl "$SSL_DIR" --host 0.0.0.0 --port 8998 --cpu-offload
```

## Configure podium-voices to use PersonaPlex

In `.env.local` (copy from `.env.example`), set:

- `CONVERSATION_BACKEND=personaplex`
- `PERSONAPLEX_SERVER_URL` (e.g. `https://localhost:8998`)
- `PERSONAPLEX_VOICE_PROMPT` (e.g. `NATF2.pt`, `NATM1.pt`, etc.)

If you use the server's temporary SSL certs, Node will see a self-signed certificate. For development you can set:

- `PERSONAPLEX_SSL_INSECURE=true`

**Do not** enable insecure TLS in production. Instead, run PersonaPlex behind a proper TLS terminator (or provide real certs to `--ssl`).

## PersonaPlex voice prompts

PersonaPlex ships pre-packaged voice prompt embeddings; the upstream repo documents these fixed names:

- Natural (female): `NATF0`, `NATF1`, `NATF2`, `NATF3`
- Natural (male):   `NATM0`, `NATM1`, `NATM2`, `NATM3`
- Variety (female): `VARF0`, `VARF1`, `VARF2`, `VARF3`, `VARF4`
- Variety (male):   `VARM0`, `VARM1`, `VARM2`, `VARM3`, `VARM4`

In config, you typically provide the filename (e.g. `NATF2.pt`), because the server expects a file inside its extracted `voices/` directory.

## Troubleshooting and logs

When an agent does not respond or PersonaPlex times out, check logs first.

- **Log file**: To capture all output to a file, set in `.env.local`:
  ```bash
  LOG_FILE=./logs/podium-voices.log
  ```
  The process creates the directory if needed. If `LOG_FILE` is unset, logs go to stdout only.

- **Useful log events**:
  - `PERSONAPLEX_FAILED` – PersonaPlex turn failed (e.g. timeout); fallback to LLM runs if `PERSONAPLEX_FALLBACK_TO_LLM=true`.
  - `PERSONAPLEX_TEXT_FAILED` – Text stream from PersonaPlex failed; audio may still have been played.
  - `AGENT_REPLY` – Agent produced a reply (success path).
  - `USER_TRANSCRIPT` – User speech was transcribed; if you see this but no `AGENT_REPLY`, the failure is in PersonaPlex, fallback LLM, or TTS.
  - `ROOM_MIXER_LEVEL` (mixer_max_abs) – If always 0, the bot’s audio may not be reaching the room (e.g. remote track silent or wrong track).

- **PersonaPlex turn timeout**: If the server is slow (e.g. first request after startup), increase the turn timeout:
  ```bash
  PERSONAPLEX_TURN_TIMEOUT_MS=60000
  ```
  Default is 30000 (30 seconds). After timeout, the audio stream is ended and, if fallback is enabled, the LLM+TTS path is used.

## Operational notes

- **Sample rates**: PersonaPlex/Mimi uses 24 kHz audio internally. This repo’s room audio is 48 kHz, and VAD/ASR use 16 kHz. The integration resamples 16 kHz → 24 kHz when sending audio to PersonaPlex and 24 kHz → 48 kHz when injecting bot audio into the room.
- **Full duplex model**: PersonaPlex generates audio *as audio is streamed in*. The integration may send additional trailing silence to allow the model to finish speaking after the user stops.

