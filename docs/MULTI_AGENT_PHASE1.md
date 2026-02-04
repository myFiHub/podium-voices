# Multi-Agent Phase 1 – Setup and Behavior

This document describes how to run **two or more AI agents** in the **same** Podium Outpost room (Phase 1 multi-agent), and how to configure `.env` for the Turn Coordinator and each agent process.

## What Phase 1 Does

- **Multiple agents, one room**: Each agent runs in its **own process** (one full pipeline: VAD → ASR → memory → LLM → TTS per agent). All agents join the **same** outpost (same `PODIUM_OUTPOST_UUID`).
- **No overlapping speech**: A separate **Turn Coordinator** process decides which agent may respond to each user utterance. Only one agent runs LLM + TTS per turn; the others skip.
- **Turn assignment**: The coordinator uses **round-robin** by default, or **name-addressing** when the user says an agent’s display name (e.g. “Alex, what do you think?”).
- **Shared dialogue**: The coordinator stores recent user/assistant turns. Before replying, each agent syncs its in-memory context from the coordinator so all agents see the same conversation.

Single-agent mode is unchanged: if you do **not** set `COORDINATOR_URL` and `AGENT_ID`, each process runs as one agent with no coordinator.

---

## .env Setup Overview

| Process | Env vars | Purpose |
|--------|----------|--------|
| **Turn Coordinator** (run once) | `COORDINATOR_PORT`, optional `COORDINATOR_AGENTS` | HTTP server port; optional agent list for round-robin order and name detection. |
| **Each agent** | `COORDINATOR_URL`, `AGENT_ID`, `AGENT_DISPLAY_NAME`, `PERSONA_ID`, plus usual Podium/ASR/LLM/TTS | Point at coordinator; unique id and display name; persona for voice/style; same room (and optionally same or different token). |

---

## Coordinator Process

Run the coordinator **first**, in its own terminal. It does **not** join the room; it only serves HTTP for turn-taking and shared turns.

**Required**

- None (defaults apply).

**Optional**

- **`COORDINATOR_PORT`** – Port for the HTTP server. Default: `3001`. Example: `COORDINATOR_PORT=3001`.
- **`COORDINATOR_AGENTS`** – Comma-separated `id:DisplayName` for round-robin order and name-addressing. Example: `COORDINATOR_AGENTS=alex:Alex,jamie:Jamie`. If unset, the coordinator discovers agent order from the first batch of request-turn calls.

**Run**

```bash
npm run build
COORDINATOR_PORT=3001 npm run start:coordinator
```

Leave this process running. All agent processes will use `COORDINATOR_URL=http://localhost:3001` (or the host/port you use).

---

## Each Agent Process

Each agent runs `npm start` with its **own** env (different `AGENT_ID`, `AGENT_DISPLAY_NAME`, `PERSONA_ID` per process). You can use separate `.env` files (e.g. `.env.alex`, `.env.jamie`) or pass vars on the command line.

**Required for multi-agent**

- **`COORDINATOR_URL`** – Base URL of the coordinator. Example: `http://localhost:3001`. If unset, the process runs as a **single agent** (no coordinator).
- **`AGENT_ID`** – Unique id for this agent (e.g. `alex`, `jamie`). Required when `COORDINATOR_URL` is set.

**Optional (multi-agent)**

- **`AGENT_DISPLAY_NAME`** – Name used for name-addressing (e.g. “Alex, …” routes to this agent). Defaults to `AGENT_ID` if unset.
- **`PERSONA_ID`** – Persona for this agent (`default`, `hype`, `calm`). Use **different** values per process so each agent has a distinct voice and style.

**Same as single-agent**

- **Podium**: `PODIUM_OUTPOST_UUID` must be the **same** for all agents (same room). `PODIUM_TOKEN` can be the same (shared identity) or different (distinct “users” in the room).
- **ASR / LLM / TTS**: Same as single-agent (e.g. `OPENAI_API_KEY`, `MODEL_PROVIDER`, `TTS_PROVIDER`, etc.). Each process can share the same keys or use different ones.

**Example – two agents, same machine**

```bash
# Terminal 2 – Agent Alex
COORDINATOR_URL=http://localhost:3001 AGENT_ID=alex AGENT_DISPLAY_NAME=Alex PERSONA_ID=default npm start

# Terminal 3 – Agent Jamie
COORDINATOR_URL=http://localhost:3001 AGENT_ID=jamie AGENT_DISPLAY_NAME=Jamie PERSONA_ID=hype npm start
```

Use the same `PODIUM_OUTPOST_UUID` (and other Podium/ASR/LLM/TTS vars) in both, unless you intentionally use different tokens for distinct identities.

---

## Optional: Launcher Script

To start the coordinator and all agents from one command (e.g. for local dev):

```bash
COORDINATOR_AGENTS=alex:Alex,jamie:Jamie npm run run-multi-agent
```

This starts the coordinator, then spawns one agent process per entry in `COORDINATOR_AGENTS` (or from a JSON config file; see [scripts/run-multi-agent.js](../scripts/run-multi-agent.js)). Each agent inherits your current env (e.g. `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`); the script overrides only `COORDINATOR_URL`, `AGENT_ID`, `AGENT_DISPLAY_NAME`, and `PERSONA_ID` per agent.

---

## Summary Checklist

1. **Build**: `npm run build`
2. **Start coordinator**: `COORDINATOR_PORT=3001 npm run start:coordinator` (leave running).
3. **Start each agent** with:
   - `COORDINATOR_URL=http://localhost:3001`
   - `AGENT_ID` and `AGENT_DISPLAY_NAME` (unique per agent)
   - `PERSONA_ID` (different per agent recommended)
   - Same `PODIUM_OUTPOST_UUID` (and other Podium/ASR/LLM/TTS vars as needed).

Single-agent: omit `COORDINATOR_URL` and `AGENT_ID` and run `npm start` as before.
