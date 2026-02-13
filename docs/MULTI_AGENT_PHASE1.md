# Multi-Agent Phase 1 – Setup and Behavior

This document describes how to run **two or more AI agents** in the **same** Podium Outpost room (Phase 1 multi-agent), and how to configure `.env` for the Turn Coordinator and each agent process. For the difference between **standard (ASR→LLM→TTS)** and **PersonaPlex** backends and how to mix them, see the [Conversation backends](../README.md#conversation-backends) section in the main README.

## What Phase 1 Does

- **Multiple agents, one room**: Each agent runs in its **own process** (one pipeline per agent). All agents join the **same** outpost (same `PODIUM_OUTPOST_UUID`). Each agent’s pipeline is either **standard** (VAD → ASR → memory → LLM → TTS) or **PersonaPlex** (VAD, optional ASR for context, then PersonaPlex for response audio).
- **No overlapping speech**: A separate **Turn Coordinator** process decides which agent may respond to each user utterance. Only one agent produces a reply per turn; the others skip.
- **Turn assignment**: The coordinator uses **round-robin** by default, or **name-addressing** when the user says an agent’s display name (e.g. “Alex, what do you think?”).
- **Shared dialogue**: The coordinator stores recent user/assistant turns. Before replying, each agent syncs its in-memory context from the coordinator so all agents see the same conversation.

Single-agent mode is unchanged: if you do **not** set `COORDINATOR_URL` and `AGENT_ID`, each process runs as one agent with no coordinator.

---

## .env Setup Overview

| Process | Env vars | Purpose |
|--------|----------|--------|
| **Turn Coordinator** (run once) | `COORDINATOR_PORT`, optional `COORDINATOR_AGENTS` | HTTP server port; optional agent list for round-robin order and name detection. |
| **Each agent** | `COORDINATOR_URL`, `AGENT_ID`, `AGENT_DISPLAY_NAME`, `PERSONA_ID`, plus **conversation backend** (`CONVERSATION_BACKEND`; PersonaPlex vars if `personaplex`) and usual Podium/ASR/LLM/TTS | Point at coordinator; unique id and display name; persona; backend (asr-llm-tts or personaplex); same room (and optionally same or different token). |

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

**Conversation backend (per agent)**

- **`CONVERSATION_BACKEND`**: `asr-llm-tts` (default) or `personaplex`. Each agent process can use a **different** backend. For **PersonaPlex** agents, also set `PERSONAPLEX_SERVER_URL`, `PERSONAPLEX_VOICE_PROMPT`, and optionally `PERSONAPLEX_SSL_INSECURE` (dev), `PERSONAPLEX_FALLBACK_TO_LLM`.
- **Mix-and-match**: To run one agent on standard ASR/LLM/TTS and another on PersonaPlex, start each agent in a **separate terminal** with the desired env (or per-agent `.env` files). The `run-multi-agent` launcher passes a **single** env to all agents, so for mixed backends you must start agents manually (coordinator once, then one terminal per agent with the right `CONVERSATION_BACKEND` and backend-specific vars).

**Same as single-agent**

- **Podium**: `PODIUM_OUTPOST_UUID` must be the **same** for all agents (same room). `PODIUM_TOKEN` can be the same (shared identity) or different (distinct “users” in the room).
- **ASR / LLM / TTS** (when using `asr-llm-tts`): Same as single-agent (e.g. `OPENAI_API_KEY`, `MODEL_PROVIDER`, `TTS_PROVIDER`, etc.). Each process can share the same keys or use different ones.

**Example – two agents, same backend (ASR/LLM/TTS), same machine**

```bash
# Terminal 2 – Agent Alex
COORDINATOR_URL=http://localhost:3001 AGENT_ID=alex AGENT_DISPLAY_NAME=Alex PERSONA_ID=default npm start

# Terminal 3 – Agent Jamie
COORDINATOR_URL=http://localhost:3001 AGENT_ID=jamie AGENT_DISPLAY_NAME=Jamie PERSONA_ID=hype npm start
```

Use the same `PODIUM_OUTPOST_UUID` (and other Podium/ASR/LLM/TTS vars) in both, unless you intentionally use different tokens for distinct identities.

**Example – mix backends: Alex = ASR/LLM/TTS, Jamie = PersonaPlex**

Start the coordinator first, then in separate terminals:

```bash
# Terminal 2 – Agent Alex (standard pipeline)
COORDINATOR_URL=http://localhost:3001 AGENT_ID=alex AGENT_DISPLAY_NAME=Alex PERSONA_ID=default CONVERSATION_BACKEND=asr-llm-tts npm start

# Terminal 3 – Agent Jamie (PersonaPlex; ensure PersonaPlex server is running)
COORDINATOR_URL=http://localhost:3001 AGENT_ID=jamie AGENT_DISPLAY_NAME=Jamie PERSONA_ID=hype CONVERSATION_BACKEND=personaplex PERSONAPLEX_SERVER_URL=https://localhost:8998 PERSONAPLEX_VOICE_PROMPT=NATF2.pt PERSONAPLEX_SSL_INSECURE=true npm start
```

Use the same `PODIUM_OUTPOST_UUID` and Podium URLs for both; only backend-related vars differ.

---

## Optional: Launcher Script

To start the coordinator and all agents from one command (e.g. for local dev), you can now provide per-agent tokens in one env source:

```bash
PODIUM_TOKENS="<token_1>,<token_2>" AGENT_IDS=alex,jamie AGENT_DISPLAY_NAMES=Alex,Jamie AGENT_PERSONAS=default,hype npm run run-multi-agent
```

Alternative token format:

```bash
PODIUM_TOKEN_1="<token_1>" PODIUM_TOKEN_2="<token_2>" AGENT_IDS=alex,jamie AGENT_DISPLAY_NAMES=Alex,Jamie npm run run-multi-agent
```

The launcher starts one coordinator and one agent process per token/index (see [scripts/run-multi-agent.js](../scripts/run-multi-agent.js)). It auto-sets `COORDINATOR_URL`, per-agent `AGENT_ID`/`AGENT_DISPLAY_NAME`/`PERSONA_ID`, and per-agent bridge/health ports. Use `PODIUM_OUTPOST_UUID` for a shared room, or `PODIUM_OUTPOST_UUIDS=uuid1,uuid2` for per-agent rooms. **All agents launched this way still share the same conversation backend config unless you split runs manually.** For mix-and-match backends (e.g. one agent PersonaPlex, one ASR/LLM/TTS), start agents manually in separate terminals instead.

---

## Summary Checklist

1. **Build**: `npm run build`
2. **Start coordinator**: `COORDINATOR_PORT=3001 npm run start:coordinator` (leave running).
3. **Start each agent** with:
   - `COORDINATOR_URL=http://localhost:3001`
   - `AGENT_ID` and `AGENT_DISPLAY_NAME` (unique per agent)
   - `PERSONA_ID` (different per agent recommended)
   - Same `PODIUM_OUTPOST_UUID` (and other Podium vars as needed)
   - For **same backend**: same `CONVERSATION_BACKEND` and ASR/LLM/TTS (or PersonaPlex) config. For **mixed backends**: start each agent in its own terminal with the desired `CONVERSATION_BACKEND` and backend-specific vars.

Single-agent: omit `COORDINATOR_URL` and `AGENT_ID` and run `npm start` as before.
