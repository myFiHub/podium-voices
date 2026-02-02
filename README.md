# Podium Voices – AI Co-Host MVP

Minimum viable AI co-host for Podium Outpost audio rooms. The agent joins as a host (creator or cohost), transcribes live speech (ASR), generates responses with an LLM, and speaks via TTS. The pipeline is **modular**: ASR, LLM, and TTS can be swapped via config (e.g. OpenAI now, self-hosted later).

## Architecture

- **Pipeline**: Audio → VAD → ASR → Session Memory + Feedback → LLM → TTS → Audio out.
- **Room**: Podium REST API + WebSocket + **Jitsi** (browser bot or stub) or **mock** for local testing.
- **Jitsi (production)**: When `USE_JITSI_BOT=true`, a Playwright-controlled browser loads a minimal **bot join page** (`bot-page/`), joins the same Jitsi conference as the Podium web client, mixes remote audio (excluding self), and injects TTS as a synthetic mic. Node↔browser audio uses **48 kHz mono 20 ms frames**; Node resamples to 16 kHz only at the ASR boundary.
- **Feedback**: WebSocket reactions (LIKE, DISLIKE, BOO, CHEER) and live data are aggregated and injected into the LLM context.
- **Observability**: Turn metrics (ASR/LLM/TTS latency, end-of-speech-to-bot-audio), watchdogs (WS, conference, audio), and structured logging.

See [AI Agents for Podium Outpost Rooms.md](AI%20Agents%20for%20Podium%20Outpost%20Rooms.md), [Checklist and Setup Guide for AI Co-Host.md](Checklist%20and%20Setup%20Guide%20for%20AI%20Co-Host.md), and [podium interface considerations.md](podium%20interface%20considerations.md) for design and Podium interface details. **[IMPLEMENTATION.md](IMPLEMENTATION.md)** documents the actual implementation: architecture, core abstractions, pipeline behavior, host join flow, browser bot, audio bridge protocol, config, and how to extend or swap components. **[docs/AGENT_MUTING_AND_SPEAKING_TIME.md](docs/AGENT_MUTING_AND_SPEAKING_TIME.md)** describes what the agent needs for Podium muting/unmuting (start_speaking / stop_speaking) and speaking time (remaining_time, user.time_is_up), aligned with the Nexus frontend; it includes an implementation-status section for this repo.

## Setup

1. **Clone and install**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env.local` and set:

   - **OpenAI**: `OPENAI_API_KEY` (for Whisper ASR and GPT-4/3.5).
   - **TTS**: `Google_Cloud_TTS_API_KEY` (or Azure TTS vars if using Azure).
   - **Podium** (optional for mock): `NEXT_PUBLIC_PODIUM_API_URL`, `NEXT_PUBLIC_WEBSOCKET_ADDRESS`, `NEXT_PUBLIC_OUTPOST_SERVER`, `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`.
   - **Browser bot** (optional): `USE_JITSI_BOT=true` for real Jitsi audio; optional `BOT_PAGE_URL` if you host the bot page elsewhere (otherwise Node serves `bot-page/` on port 8766).
   - **Greeting** (optional): `GREETING_TEXT` = first thing the bot says when it joins (default: "Hello! I'm the AI co-host. What would you like to talk about?"). Set to empty to disable. `GREETING_DELAY_MS` = delay in ms before speaking (default 2000).

   The agent must be **creator or cohost** of the outpost (see [podium interface considerations.md](podium%20interface%20considerations.md)). For real audio in/out, set `USE_JITSI_BOT=true` and ensure Playwright Chromium is installed (`npx playwright install chromium`).

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

- **Starting the dialogue**: When the bot joins the room, it speaks a **greeting** after a short delay (default 2 seconds). Customize with `GREETING_TEXT`; set `GREETING_TEXT=` to disable.
- **Responding to you**: The bot listens to **remote audio** (your mic) and replies after you finish speaking (VAD detects silence). For the bot to hear you, **unmute your microphone** in the meeting. If the bot never responds, check that your client is not muting outgoing audio and that the bot process logs show incoming audio (e.g. `USER_TRANSCRIPT` after you talk).

## Config

- **ASR_PROVIDER**: `openai` (Whisper API) or `stub`.
- **MODEL_PROVIDER** / **LLM_PROVIDER**: `openai`, `anthropic`, or `stub`.
- **TTS_PROVIDER**: `google`, `azure`, or `stub`.
- **Pipeline**: `VAD_SILENCE_MS`, `MAX_TURNS_IN_MEMORY`; **GREETING_TEXT** (first thing the bot says when it joins; empty = no greeting); **GREETING_DELAY_MS** (ms before speaking the greeting, default 2000).
- **Podium**: `NEXT_PUBLIC_*`, `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`; **USE_JITSI_BOT** (`true` = browser bot for real Jitsi audio); **BOT_PAGE_URL** (optional; default = Node serves `bot-page/` on 8766).

See `.env.example` for all variables.

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

- Unit tests cover adapters (stub/factory), memory, and prompts.
- Integration test runs the orchestrator with a mock room (stub ASR/LLM/TTS).

## Smoke test (staging / production)

With `USE_JITSI_BOT=true` and a real outpost, run the smoke script and follow the runbook:

```bash
USE_JITSI_BOT=true npm run smoke
```

See [docs/SMOKE_TEST_RUNBOOK.md](docs/SMOKE_TEST_RUNBOOK.md) for two-account smoke test, audio loop sanity checks, and reconnect/resume test.

## Project layout

```
bot-page/         – Minimal Jitsi bot join page (HTML + JS); served by Node when USE_JITSI_BOT=true
docs/             – Smoke test runbook; muting and speaking-time spec (Nexus/Podium)
scripts/          – Smoke script (npm run smoke)
src/
  config/         – Env-based config
  adapters/       – ASR, LLM, TTS (openai, anthropic, google, azure, stub)
  memory/         – Session rolling buffer
  prompts/        – Co-host system prompt and feedback injection
  pipeline/       – VAD, orchestrator, audio utils
  room/           – Podium API, WebSocket, Jitsi (stub + browser bot), audio-bridge-protocol, client, mock
  feedback/       – Reaction collector (cheer/boo)
  metrics/        – Turn metrics (ASR/LLM/TTS latency), watchdogs (WS, conference, audio)
  logging/        – Structured logger
  main.ts         – Entry point
tests/            – Unit and integration tests (Jest + ts-jest)
```

## License

Private / internal use as per your project policy.
