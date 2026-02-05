# PersonaPlex (NVIDIA) Setup and Integration Notes

This repo can optionally use **PersonaPlex** as a speech-to-speech backend (instead of the default ASR → LLM → TTS chain).

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

## Operational notes

- **Sample rates**: PersonaPlex/Mimi uses 24 kHz audio internally. This repo’s room audio is 48 kHz, and VAD/ASR use 16 kHz. The integration resamples 16 kHz → 24 kHz when sending audio to PersonaPlex and 24 kHz → 48 kHz when injecting bot audio into the room.
- **Full duplex model**: PersonaPlex generates audio *as audio is streamed in*. The integration may send additional trailing silence to allow the model to finish speaking after the user stops.

