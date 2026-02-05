#!/usr/bin/env bash
# Run PersonaPlex server with HF cache on D: and HF_TOKEN from podium-voices .env.local.
# Usage: from podium-voices repo root, ./scripts/run-personaplex-server.sh
# Optional: PERSONAPLEX_DIR=/path/to/personaplex (default: /mnt/d/personaplex)

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PERSONAPLEX_DIR="${PERSONAPLEX_DIR:-/mnt/d/personaplex}"
HF_CACHE="${HF_CACHE:-/mnt/d/hf_cache}"

# Hugging Face cache on D:
export HF_HOME="$HF_CACHE"
export HUGGINGFACE_HUB_CACHE="$HF_CACHE/hub"
mkdir -p "$HF_CACHE" "$HUGGINGFACE_HUB_CACHE"

# Load HF_TOKEN from .env.local (strip CR for WSL/Windows)
if [[ -f "$REPO_ROOT/.env.local" ]]; then
  set -a
  source <(sed 's/\r$//' "$REPO_ROOT/.env.local")
  set +a
fi
if [[ -z "$HF_TOKEN" ]]; then
  echo "HF_TOKEN is not set. Add HF_TOKEN=... to $REPO_ROOT/.env.local or export it." >&2
  exit 1
fi

if [[ ! -d "$PERSONAPLEX_DIR" ]]; then
  echo "PersonaPlex not found at $PERSONAPLEX_DIR. Clone with: git clone https://github.com/NVIDIA/personaplex $PERSONAPLEX_DIR" >&2
  exit 1
fi

cd "$PERSONAPLEX_DIR"
SSL_DIR="${SSL_DIR:-$(mktemp -d)}"
echo "HF cache: $HF_HOME"
echo "SSL dir: $SSL_DIR"
echo "Starting PersonaPlex server on port 8998..."
exec python3 -m moshi.server --ssl "$SSL_DIR" --host 0.0.0.0 --port 8998
