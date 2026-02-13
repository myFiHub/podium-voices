# Recommended env presets (MVP)

For repeatable show formats, use one of these env profiles as a starting point. Copy the block into `.env.local` (or set in the shell) and override as needed. Only the differing or notable variables are listed; other values come from [.env.example](../.env.example).

---

## Debate

Higher energy, shorter replies, clear turn-taking. Suited for multi-agent or single-agent debate-style segments.

```bash
PERSONA_ID=default
VAD_SILENCE_MS=400
OPENER_DELAY_MS=800
OPENER_MAX_TOKENS=150
# Multi-agent: COORDINATOR_AGENTS=alex:Alex,jamie:Jamie and per-agent AGENT_ID/AGENT_DISPLAY_NAME
```

---

## Interview

Calmer tone, slightly longer replies, good for single host + guest or Q&A style.

```bash
PERSONA_ID=calm
VAD_SILENCE_MS=500
OPENER_DELAY_MS=1500
OPENER_MAX_TOKENS=180
TOPIC_SEED=interview
```

---

## Hype

High energy, audience-driven, shorter punchy replies. Good for reaction-heavy segments.

```bash
PERSONA_ID=hype
VAD_SILENCE_MS=350
OPENER_DELAY_MS=500
OPENER_MAX_TOKENS=120
```

---

Use `.env.example` for all other variables (Podium, ASR, LLM, TTS, etc.).
