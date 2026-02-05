# Podium Voices – AI Co-Host MVP

Minimum viable AI co-host for Podium Outpost audio rooms. The agent joins the room using the configured token (permission is enforced by the Podium API), transcribes live speech (ASR), generates responses with an LLM, and speaks via TTS. The pipeline is **modular**: ASR, LLM, and TTS can be swapped via config (e.g. OpenAI now, self-hosted later).

## PersonaPlex mode (optional)

This repo can optionally use **[NVIDIA PersonaPlex](https://github.com/NVIDIA/personaplex)** as a speech-to-speech conversation backend (instead of the default ASR → LLM → TTS chain).

- **What changes**: Podium-voices still does VAD and (optionally) ASR for session memory/coordinator behavior, but **PersonaPlex generates the spoken response audio** via its `/api/chat` WebSocket API.
- **Setup**: See [docs/PERSONAPLEX_SETUP.md](docs/PERSONAPLEX_SETUP.md) for installing and running the PersonaPlex server (Python, HF_TOKEN, libopus-dev).

## Architecture

- **Pipeline**: Audio → VAD → ASR → Session Memory + Feedback → LLM → TTS → Audio out.
- **Room**: Podium REST API + WebSocket + **Jitsi** (browser bot or stub) or **mock** for local testing.
- **Jitsi (production)**: When `USE_JITSI_BOT=true`, a Playwright-controlled browser loads a minimal **bot join page** (`bot-page/`), joins the same Jitsi conference as the Podium web client, mixes remote audio (excluding self), and injects TTS as a synthetic mic. Node↔browser audio uses **48 kHz mono 20 ms frames**; Node resamples to 16 kHz only at the ASR boundary.
- **Room audio in (receive)**: Chromium does not feed decoded remote WebRTC audio into Web Audio unless the stream is also consumed by a media element. The bot applies a **Chrome workaround** (hidden muted `<audio>` element per remote track) so the mixer receives real PCM; see [docs/AUDIO_RECEIVE_STATUS_AND_RESEARCH.md](docs/AUDIO_RECEIVE_STATUS_AND_RESEARCH.md).
- **Feedback**: Podium WebSocket reactions (incoming events: `user.liked`, `user.disliked`, `user.booed`, `user.cheered`) are aggregated into a short-lived “reaction register” (counts, and optional `amount` sums) and injected into the LLM context. A threshold-derived **behavior level** drives tone/style guidance (negative-biased so de-escalation wins when mixed), and can be tuned per persona.
- **Observability**: Turn metrics (ASR/LLM/TTS latency, end-of-speech-to-bot-audio), watchdogs (WS, conference, audio), and structured logging.

See [AI Agents for Podium Outpost Rooms.md](AI%20Agents%20for%20Podium%20Outpost%20Rooms.md), [Checklist and Setup Guide for AI Co-Host.md](Checklist%20and%20Setup%20Guide%20for%20AI%20Co-Host.md), and [podium interface considerations.md](podium%20interface%20considerations.md) for design and Podium interface details. **[IMPLEMENTATION.md](IMPLEMENTATION.md)** documents the actual implementation: architecture, core abstractions, pipeline behavior, host join flow, browser bot, audio bridge protocol, config, and how to extend or swap components. **[docs/AGENT_MUTING_AND_SPEAKING_TIME.md](docs/AGENT_MUTING_AND_SPEAKING_TIME.md)** describes what the agent needs for Podium muting/unmuting (start_speaking / stop_speaking) and speaking time (remaining_time, user.time_is_up), aligned with the Nexus frontend; it includes an implementation-status section for this repo.

## Setup

1. **Clone and install**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env.local` and set:

   - **Conversation backend (optional)**: Set `CONVERSATION_BACKEND=personaplex` and configure `PERSONAPLEX_SERVER_URL` + `PERSONAPLEX_VOICE_PROMPT`. For dev self-signed certs, set `PERSONAPLEX_SSL_INSECURE=true` (unsafe for production).
   - **OpenAI**: `OPENAI_API_KEY` (for Whisper ASR and GPT-4/3.5).
   - **TTS**: `Google_Cloud_TTS_API_KEY` (or Azure TTS vars if using Azure).
   - **Podium** (optional for mock): `NEXT_PUBLIC_PODIUM_API_URL`, `NEXT_PUBLIC_WEBSOCKET_ADDRESS`, `NEXT_PUBLIC_OUTPOST_SERVER`, `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`.
   - **Browser bot** (optional): `USE_JITSI_BOT=true` for real Jitsi audio. Optional `BOT_PAGE_URL` only if you host the bot page elsewhere (otherwise Node serves `bot-page/` on the bridge port). Optional `JITSI_BRIDGE_PORT` to pick the starting port (defaults to 8766; will retry multiple ports and can fall back to an ephemeral port).
   - **Audio debug (optional)**: `DEBUG_AUDIO_FRAMES=1` enables per-frame integrity checks across the Node↔browser bridge. `SAVE_TTS_WAV=1` captures short WAVs for inspecting the TTS audio at different pipeline boundaries (saved under `debug-audio/`). **`BOT_DIAG=1`** runs a 20s diagnostic capture, writes `./logs/diag/*_stats.jsonl`, prints a verdict, then exits—use only when debugging receive/audio issues; **omit or remove it for normal long-running use** (see [Response latency and tuning](#response-latency-and-tuning) and [docs/AUDIO_DEBUGGING.md](docs/AUDIO_DEBUGGING.md)).
   - **Opener / greeting** (optional): If `GREETING_TEXT` is non-empty, the bot will speak it after `GREETING_DELAY_MS`. Otherwise, if `OPENER_ENABLED=true`, the bot will generate a short storyteller-style opener (LLM) after `OPENER_DELAY_MS` (guided by `TOPIC_SEED` and outpost metadata).

   The agent can join any room the token has permission to join (the Podium backend enforces this; creator/cohost still get unlimited speaking time where applicable). For real audio in/out, set `USE_JITSI_BOT=true` and ensure Playwright Chromium is installed (`npx playwright install chromium`).

3. **Build and run**

   ```bash
   npm run build
   npm start
   ```

   Or in development:

   ```bash
   npm run dev
   ```

   Without `PODIUM_TOKEN` and `PODIUM_OUTPOST_UUID`, the app uses a **mock room** (no real Podium connection). TTS output can be written to a file (see `MOCK_TTS_OUTPUT`). With Podium set but `USE_JITSI_BOT=false` (default), the app joins REST + WebSocket but uses a **Jitsi stub** (no conference audio); set `USE_JITSI_BOT=true` for real Jitsi audio via the browser bot.

   **WSL**: The Jitsi bot bridge binds to `0.0.0.0` so the headless browser can connect reliably in WSL2. If you see `BOT_BRIDGE_CONNECT_TIMEOUT`, ensure Chromium is installed (`npx playwright install chromium`) and that no firewall is blocking local connections.

## Bot behavior

- **Starting the dialogue**: When the bot joins the room, it either speaks a fixed **greeting** (`GREETING_TEXT`) or generates a storyteller-style **opener** (LLM) if `OPENER_ENABLED=true` and `GREETING_TEXT` is empty. Use `TOPIC_SEED` to steer the opener.
- **Responding to you**: The bot listens to **remote audio** (your mic) and replies after you finish speaking (VAD detects silence). For the bot to hear you, **unmute your microphone** in the meeting. If the bot never responds, check that your client is not muting outgoing audio and that the bot process logs show incoming audio (e.g. `USER_TRANSCRIPT` after you talk).
- **Natural / influencer-style voice**: To reduce stilted or corporate-sounding replies, set **`PERSONA_ID=influencer`** in `.env.local`. The base prompt also includes speaking-style guidance (react to what was said, vary rhythm, natural transitions) so even `default` should sound more like a real host. For a stronger podcast/influencer vibe (e.g. mix of Obama/Rogan or Harris/Alex Cooper–style warmth and directness), use **`influencer`**.

## Config

- **ASR_PROVIDER**: `openai` (Whisper API), `whisper-local` (server-local/self-hosted Whisper), or `stub`.
  - For `whisper-local`: set `WHISPER_MODEL` (e.g. `base`, `small`), optional `WHISPER_ENGINE` (default `faster-whisper`), optional `WHISPER_PYTHON_PATH` (defaults to `python3`).
- **MODEL_PROVIDER** / **LLM_PROVIDER**: `openai`, `anthropic`, or `stub`.
- **TTS_PROVIDER**: `google`, `azure`, or `stub`.
- **Pipeline**: `VAD_SILENCE_MS`, `MAX_TURNS_IN_MEMORY`; `GREETING_TEXT`, `GREETING_DELAY_MS`; `OPENER_ENABLED`, `OPENER_DELAY_MS`, `OPENER_MAX_TOKENS`, `TOPIC_SEED`.
- **Podium**: `NEXT_PUBLIC_*`, `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`; **USE_JITSI_BOT** (`true` = browser bot for real Jitsi audio); **BOT_PAGE_URL** (optional; default = Node serves `bot-page/` on the bridge port, starting at 8766).
- **Agent / persona / feedback**:
  - **`PERSONA_ID`**: `default` | `hype` | `calm` | **`influencer`** (system prompt + feedback thresholds + optional feedback wording). Use **`influencer`** for a more natural, podcast/influencer-like voice (warmer, more direct, better flow).
  - **`FEEDBACK_REACT_TO_ADDRESS`**: filter which reactions are counted:
    - unset/empty = count all room reactions (room mood)
    - `self` = count only reactions targeting the bot’s wallet address
    - `0x...` = count only reactions targeting that wallet address
- **Multi-agent (Phase 1)**: See [Multi-agent (Phase 1)](#multi-agent-phase-1) below for full setup.
- **Audio debug**: `DEBUG_AUDIO_FRAMES=1` adds a small per-frame header on the Node→browser TTS stream and logs `frame_ack` acks from the browser so we can verify byte-level integrity. `SAVE_TTS_WAV=1` saves short WAV captures to `debug-audio/` for offline inspection.
- **Bot diagnostics (optional)**: **`BOT_DIAG=1`** runs a ~20s capture, writes `./logs/diag/*_stats.jsonl`, prints a verdict (e.g. `OK`, `INBOUND_RTP_BUT_PREMIX_SILENT`), then exits. **Leave unset or remove from `.env.local` for normal operation**; use only when debugging “bot doesn’t hear me” or receive-path issues. `BOT_DIAG_DURATION_MS` (default 20000), `PRE_MIXER_PASS_THRESHOLD`, `ARTIFACT_RETENTION_N` tune the diagnostic; see `.env.example` and [docs/AUDIO_DEBUGGING.md](docs/AUDIO_DEBUGGING.md).

See `.env.example` for all variables.

### Multi-agent (Phase 1)

Phase 1 lets **two or more AI agents** join the **same** Podium Outpost room with distinct personas and no overlapping speech. Each agent runs in its **own process** (one pipeline per agent). A separate **Turn Coordinator** process decides which agent may respond to each user utterance (round-robin or by name in the transcript) and stores shared conversation turns so all agents see the same recent dialogue.

**You run three (or more) processes:** one coordinator, then one agent process per AI. The coordinator does **not** load `.env.local`; you set its env vars in the shell when you start it. Each agent process loads `.env.local` (or you override vars in the shell per terminal).

---

**What to add or change for each agent**

Start from your existing single-agent `.env.local`. For multi-agent you **add** these for every agent (and **change** one if you want two distinct participants):

| Add or change | Example | Purpose |
|---------------|---------|--------|
| **Add** `COORDINATOR_URL` | `http://localhost:3001` | Required so this process talks to the coordinator. |
| **Add** `AGENT_ID` | `alex` or `jamie` | Unique id per agent (required when using coordinator). |
| **Add** `AGENT_DISPLAY_NAME` | `Alex` or `Jamie` | Name-addressing (e.g. “Alex, what do you think?”). |
| **Change** `PERSONA_ID` per agent | `default` vs `hype` | Different tone/style per agent (recommended). |
| **Change** `PODIUM_TOKEN` per agent | Token 1 vs Token 2 | Use a **separate** Podium token per agent so they appear as two different participants in the room. |

Keep **the same** for both agents: `PODIUM_OUTPOST_UUID` (same room), all ASR/LLM/TTS and Podium API/WS URLs, Jitsi settings, and pipeline options. Only coordinator-related vars and agent identity (and optionally token) differ per process.

**Coordinator env (set in shell when starting; not in .env.local)**

| Env | Example | Purpose |
|-----|---------|--------|
| `COORDINATOR_PORT` | `3001` | Port the coordinator HTTP server listens on. |
| `COORDINATOR_AGENTS` | `alex:Alex,jamie:Jamie` | Optional: round-robin order and name-addressing. |

---

**How to run (two agents)**

1. **Build once:** `npm run build`

2. **Terminal 1 – Start the coordinator**  
   The coordinator does not read `.env.local`; pass vars in the shell:
   ```bash
   COORDINATOR_PORT=3001 COORDINATOR_AGENTS=alex:Alex,jamie:Jamie npm run start:coordinator
   ```
   Leave this running.

3. **Terminal 2 – Agent 1 (e.g. Alex)**  
   Your existing `.env.local` is loaded. Add coordinator and agent identity by overriding in the shell (or add them to `.env.local` and override only the second agent in the next step):
   ```bash
   COORDINATOR_URL=http://localhost:3001 AGENT_ID=alex AGENT_DISPLAY_NAME=Alex PERSONA_ID=default npm start
   ```
   This uses the `PODIUM_TOKEN` (and everything else) from `.env.local`.

4. **Terminal 3 – Agent 2 (e.g. Jamie)**  
   Same `.env.local`; override identity, persona, and **use a second Podium token** so this agent is a different participant:
   ```bash
   COORDINATOR_URL=http://localhost:3001 AGENT_ID=jamie AGENT_DISPLAY_NAME=Jamie PERSONA_ID=hype PODIUM_TOKEN=<your_second_podium_token> npm start
   ```
   Replace `<your_second_podium_token>` with the second account’s token. All other vars (outpost UUID, API keys, etc.) come from `.env.local`.

**Optional launcher:** To start coordinator and all agents from one command:
```bash
COORDINATOR_AGENTS=alex:Alex,jamie:Jamie npm run run-multi-agent
```
See [scripts/run-multi-agent.js](scripts/run-multi-agent.js). You still need a second `PODIUM_TOKEN` for the second agent (e.g. via a config file or env).

**Behavior**

- When a user speaks, every agent’s pipeline runs ASR and gets the transcript. Each agent asks the coordinator for permission to respond. The coordinator picks **one** agent (by name in the transcript if present, otherwise round-robin) and grants the turn; only that agent runs LLM + TTS. The others skip replying.
- After the chosen agent replies, it calls `end-turn` so the coordinator clears the “current speaker” and appends the turn to shared history. The next user utterance can then be assigned to another agent.
- **Single-agent mode:** Leave `COORDINATOR_URL` and `AGENT_ID` unset; run `npm start` as usual with one process.

For a full checklist and optional per-agent `.env` files, see **[docs/MULTI_AGENT_PHASE1.md](docs/MULTI_AGENT_PHASE1.md)**.

### Response latency and tuning

End-to-end delay (user stops speaking → bot starts speaking) is dominated by ASR and LLM. You can tune **env only** (no code changes) as follows:

| Env | Purpose | Effect on speed |
|-----|---------|-----------------|
| **VAD_SILENCE_MS** | Silence duration (ms) after speech to trigger “end of turn”. Default 500. | Lower (e.g. 300–400) = less wait before ASR runs; too low may cut off slow speakers. |
| **OPENAI_MODEL_NAME** | Chat model for LLM (e.g. `gpt-4o-mini`, `gpt-4o`). Must be a **chat** model for `/v1/chat/completions`. | Smaller/faster model (e.g. `gpt-4o-mini`) = lower LLM latency. |
| **VAD_ENERGY_THRESHOLD** | Optional; energy-based VAD when webrtcvad unavailable. Default 500. | Lower = more sensitive to quiet mics; may detect speech earlier. |
| **VAD_AGGRESSIVENESS** | Optional; 0–3, only if webrtcvad native module is used. Default 1. | Lower (0) = more sensitive; may end turn sooner. |

Further latency improvements (e.g. streaming ASR, different APIs) require code changes; see [IMPLEMENTATION.md](IMPLEMENTATION.md).

### External configuration (Podium + Jitsi)

**Required to join a real Podium room**

| Env / source | Purpose |
|--------------|--------|
| `PODIUM_TOKEN` | JWT from Podium login; used for REST API and WebSocket auth. |
| `PODIUM_OUTPOST_UUID` | Which outpost (room) to join. |
| `NEXT_PUBLIC_PODIUM_API_URL` | Podium REST API base (e.g. `https://api.podium.example.com/api/v1`). |
| `NEXT_PUBLIC_WEBSOCKET_ADDRESS` | Podium WebSocket URL (e.g. `wss://ws.podium.example.com/ws`). |

**Jitsi domain (where the meet runs)**

- **Primary**: The Podium API returns the outpost with `outpost_host_url` (e.g. `https://outposts.myfihub.com`). The app uses that hostname to load lib-jitsi-meet and for BOSH (`/http-bind`). No extra env needed if the API returns this.
- **Fallback**: If the API does **not** return `outpost_host_url`, set `NEXT_PUBLIC_OUTPOST_SERVER` to the Jitsi public hostname (hostname only, no `https://`).

**Jitsi XMPP domain (when public URL ≠ Prosody host)**

- **`JITSI_XMPP_DOMAIN`**: Prosody VirtualHost / XMPP domain (e.g. `meet.jitsi`). **Required** when the public meet URL (e.g. `outposts.myfihub.com`) differs from the Prosody host. Set this so JIDs and MUC use the correct domain.

**Jitsi MUC domain (when using Jitsi Docker)**

- **`JITSI_MUC_DOMAIN`**: XMPP MUC domain for conference rooms (room JID = `roomName@muc`). The **official Jitsi Docker** stack uses **`muc.<domain>`** (e.g. `muc.meet.jitsi`), not `conference.<domain>`. **Required** when the server’s `config.hosts.muc` is `muc.meet.jitsi`; set `JITSI_MUC_DOMAIN=muc.meet.jitsi`. If unset, the bot defaults to `conference.<JITSI_XMPP_DOMAIN>` (which will fail on Jitsi Docker).

**Optional (MVP)**

| Env | Purpose |
|-----|--------|
| `USE_JITSI_BOT` | `true` = real Jitsi audio via browser bot; `false` = Jitsi stub (no audio). |
| `BOT_PAGE_URL` | URL of the bot join page if you host it elsewhere; otherwise Node serves `bot-page/` on the bridge port. |
| `JITSI_BRIDGE_PORT` | First port for the Node↔bot bridge (default 8766); next ports tried if in use. |

**Summary:** Current MVP does not use Jitsi JWT. You have everything needed if (1) Podium API and WS URLs, token, and outpost UUID are set, (2) the API returns `outpost_host_url` or you set `NEXT_PUBLIC_OUTPOST_SERVER`, (3) when the meet public host differs from Prosody you set `JITSI_XMPP_DOMAIN`, and (4) when using Jitsi Docker you set `JITSI_MUC_DOMAIN=muc.meet.jitsi`. The bot page already accepts `config.jwt` for JitsiConnection, so adding JWT later (e.g. via env and join config) is a small, modular change.

### Jitsi Docker (server) configuration reference

When the meet is served by the **official [jitsi/docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet)** stack, the server’s `config.js` and env define the values the bot must use. Align your `.env.local` as follows:

| Server value (from `config.js` / container env) | Bot env / behavior |
|------------------------------------------------|---------------------|
| `config.hosts.domain` (e.g. `meet.jitsi`)     | `JITSI_XMPP_DOMAIN=meet.jitsi` |
| `config.hosts.muc` (e.g. `muc.meet.jitsi`)     | `JITSI_MUC_DOMAIN=muc.meet.jitsi` |
| `config.bosh` (e.g. `https://outposts.myfihub.com/http-bind`) | Bot builds BOSH from public domain; ensure `outpost_host_url` or `NEXT_PUBLIC_OUTPOST_SERVER` is that hostname (e.g. `outposts.myfihub.com`). |
| `config.websocket` (e.g. `wss://outposts.myfihub.com/xmpp-websocket`) | Optional; bot uses BOSH by default. |

**Example (outposts.myfihub.com + Jitsi Docker):**

- Public URL: `https://outposts.myfihub.com` → API returns `outpost_host_url` or set `NEXT_PUBLIC_OUTPOST_SERVER=outposts.myfihub.com`.
- XMPP domain: `meet.jitsi` → `JITSI_XMPP_DOMAIN=meet.jitsi`.
- MUC domain: `muc.meet.jitsi` → `JITSI_MUC_DOMAIN=muc.meet.jitsi`.

**How to verify on the server:** See [docs/JITSI_DOCKER_CONFIG.md](docs/JITSI_DOCKER_CONFIG.md) for step-by-step commands to read `config.js` and env from the web and Prosody containers.

**Next steps after configuring:** Set `JITSI_MUC_DOMAIN=muc.meet.jitsi` in `.env.local` (and `JITSI_XMPP_DOMAIN=meet.jitsi` if not already set), then `npm run build` and `npm start`. If the bot still fails to join, check Prosody logs (`docker logs jitsi-docker-prosody-1`) and the bot console output for auth or JID mismatches; add JWT or adjust domains if required.

## Tests

```bash
npm test
npm run test:unit
npm run test:integration
```

- Unit tests cover adapters (stub/factory), memory, prompts, and coordinator client.
- Integration tests: orchestrator with mock room; Turn Coordinator HTTP API.

## Smoke test (staging / production)

With `USE_JITSI_BOT=true` and a real outpost, run the smoke script and follow the runbook:

```bash
USE_JITSI_BOT=true npm run smoke
```

See [docs/SMOKE_TEST_RUNBOOK.md](docs/SMOKE_TEST_RUNBOOK.md) for two-account smoke test, audio loop sanity checks, and reconnect/resume test.

## Audio debugging (when “no audio”)

When the bot joins but you don’t hear TTS (or the bot doesn’t hear you), the fastest way to pinpoint the failure is to prove each boundary in order:

- **Node TTS bytes are non-silent** (contract check in logs; optional Node TX WAV capture)
- **Browser receives the same bytes** (optional `DEBUG_AUDIO_FRAMES=1` acks)
- **Browser WebAudio actually outputs non-silent samples** (`tx_out_max_abs`, `tx_out_nonzero`)
- **WebRTC is actually sending audio** (`out_audio_bytes_sent` grows)

Enable deep diagnostics:

```bash
LOG_LEVEL=info DEBUG_AUDIO_FRAMES=1 SAVE_TTS_WAV=1 USE_JITSI_BOT=true npm start
```

- WAV files are written under `debug-audio/` (e.g. `tts_node_tx_*.wav`, `tts_page_rx_*.wav`, `tts_page_out_*.wav`).
- For what specific fields/logs to look for, see **[docs/AUDIO_DEBUGGING.md](docs/AUDIO_DEBUGGING.md)**.

## Project layout

```
bot-page/         – Minimal Jitsi bot join page (HTML + JS); served by Node when USE_JITSI_BOT=true
docs/             – Smoke test runbook; muting and speaking-time spec (Nexus/Podium)
scripts/          – Smoke script (npm run smoke)
src/
  config/         – Env-based config
  coordinator/    – Turn Coordinator (multi-agent): HTTP service + client for turn-taking and shared turns
  adapters/       – ASR, LLM, TTS (openai, anthropic, google, azure, stub)
  memory/         – Session rolling buffer
  prompts/        – Co-host system prompt and feedback injection
  pipeline/       – VAD, orchestrator, audio utils
  room/           – Podium API, WebSocket, Jitsi (stub + browser bot), audio-bridge-protocol, client, mock
  feedback/       – Reaction collector (cheer/boo)
  metrics/        – Turn metrics (ASR/LLM/TTS latency), watchdogs (WS, conference, audio)
  logging/        – Structured logger
  main.ts         – Entry point (agent process)
scripts/          – Smoke script; run-multi-agent (optional launcher for coordinator + N agents)
tests/            – Unit and integration tests (Jest + ts-jest)
```

## License

Private / internal use as per your project policy.
