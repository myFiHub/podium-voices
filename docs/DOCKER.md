# Docker – Build and run

How to build and run Podium Voices with Docker and Docker Compose. The agent and Turn Coordinator use the same image; only the command differs.

---

## Build

The Dockerfile uses a **multi-stage build**:

- **Builder stage:** Installs all dependencies (including devDependencies), compiles TypeScript (`npm run build`), and produces `dist/`.
- **Final stage:** Installs only production dependencies, copies `dist/` from the builder, and installs Playwright Chromium. The final image does not contain TypeScript or other dev tools.

Build the image:

```bash
docker compose build
```

Or with no cache (e.g. after dependency or Dockerfile changes):

```bash
docker compose build --no-cache
```

---

## Environment and secrets

Containers receive env vars from the **host environment** where you run `docker compose`. Never put real secrets in the Dockerfile or in committed files.

### Option 1: Env file

Use a local env file (e.g. `.env.local`) that is not committed. Compose will load it and pass the variables into the services:

```bash
docker compose --env-file .env.local build
docker compose --env-file .env.local up -d
```

### Option 2: Shell exports

Export variables in the same shell where you run Compose, then start:

```bash
export PODIUM_TOKEN="your-jwt"
export PODIUM_OUTPOST_UUID="your-outpost-uuid"
export NEXT_PUBLIC_PODIUM_API_URL="https://..."
export NEXT_PUBLIC_WEBSOCKET_ADDRESS="wss://..."
export OPENAI_API_KEY="..."
# ... other required vars (see .env.example)

docker compose up -d
```

### Option 3: Token from a file (no token in env)

To avoid putting the Podium token in environment variables, use `PODIUM_TOKEN_FILE`:

1. Write the token to a file (e.g. `./secrets/podium_token`, no `PODIUM_TOKEN=` prefix).
2. In `docker-compose.yml`, add a volume and set `PODIUM_TOKEN_FILE`:

   ```yaml
   environment:
     - PODIUM_TOKEN_FILE=/run/secrets/podium_token
     # ... other vars (do not set PODIUM_TOKEN)
   volumes:
     - ./secrets/podium_token:/run/secrets/podium_token:ro
   ```

3. Do not set `PODIUM_TOKEN`; the app will read the token from the file at startup.

---

## Required and optional variables

See `docker-compose.yml` for the list of variables passed through. At minimum the agent needs:

- **Podium:** `PODIUM_TOKEN` (or `PODIUM_TOKEN_FILE`), `PODIUM_OUTPOST_UUID`, `NEXT_PUBLIC_PODIUM_API_URL`, `NEXT_PUBLIC_WEBSOCKET_ADDRESS`
- **Pipeline:** ASR/LLM/TTS keys (e.g. `OPENAI_API_KEY`, `Google_Cloud_TTS_API_KEY`)

Optional: `USE_JITSI_BOT`, `COORDINATOR_URL`, `AGENT_ID`, `AGENT_DISPLAY_NAME`, `PERSONA_ID`, `JITSI_XMPP_DOMAIN`, `JITSI_MUC_DOMAIN`, `LOG_LEVEL`, `HEALTH_PORT`, etc. See `.env.example` for the full list.

The **Turn Coordinator** service only needs coordinator-related vars (e.g. `COORDINATOR_PORT`, `COORDINATOR_AGENTS`).

---

## Run

Start both services (agent + coordinator):

```bash
docker compose --env-file .env.local up -d
```

### Multi-agent launcher (single env file)

To launch multiple agents from one env file, use the multi-agent profile and service:

```bash
docker compose --profile multi-agent --env-file .env.local up -d podium-voices-multi-agent
```

Recommended env pattern in `.env.local`:

```bash
PODIUM_TOKENS=<token_1>,<token_2>
AGENT_IDS=alex,jamie
AGENT_DISPLAY_NAMES=Alex,Jamie
AGENT_PERSONAS=default,hype
# Optional when each agent joins a different room:
# PODIUM_OUTPOST_UUIDS=<uuid_1>,<uuid_2>
```

Alternative numbered-token pattern:

```bash
PODIUM_TOKEN_1=<token_1>
PODIUM_TOKEN_2=<token_2>
AGENT_IDS=alex,jamie
AGENT_DISPLAY_NAMES=Alex,Jamie
```

`podium-voices-multi-agent` runs one internal coordinator plus one agent process per token.

View logs:

```bash
docker compose logs -f podium-voices-agent
docker compose logs -f turn-coordinator
docker compose logs -f podium-voices-multi-agent
```

Stop:

```bash
docker compose down
```

---

## Services

| Service                 | Command                          | Notes                                      |
|-------------------------|----------------------------------|--------------------------------------------|
| `podium-voices-agent`   | `node dist/main.js`              | Main agent. Restart: `unless-stopped`.     |
| `turn-coordinator`      | `node dist/coordinator/index.js` | Exposes port 3001. Restart: `unless-stopped`. |
| `podium-voices-multi-agent` | `node scripts/run-multi-agent.js` | Profile `multi-agent`; starts internal coordinator + N agents from one env file. |

For multi-agent, run multiple agent containers with different `AGENT_ID`, `AGENT_DISPLAY_NAME`, and (if needed) `PODIUM_TOKEN`, or scale and pass per-instance env (e.g. via Compose profiles or a separate stack).
