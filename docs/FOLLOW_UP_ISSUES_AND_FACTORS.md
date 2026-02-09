# Follow-Up Engagement: Issues and Factors

**Purpose:** What can break follow-up dialogue (listening + responding after the initial greeting) and what to verify. The **standard pipeline** (ASR→LLM→TTS) is the default; PersonaPlex is an optional backend and is not required for or involved in the standard flow.

---

## 1. Standard pipeline (ASR→LLM→TTS)

When `CONVERSATION_BACKEND` is unset or `asr-llm-tts`, the turn flow is:

**VAD → ASR → (coordinator, if set) → memory → LLM → TTS.**

PersonaPlex is not used. Follow-up depends only on: room audio reaching Node, VAD/ASR, coordinator (if multi-agent), LLM, and TTS.

### 1.1 What can break follow-up (standard pipeline)

| Issue | Symptom | What to check |
|-------|---------|----------------|
| **Room audio silent at Node** | `ROOM_AUDIO_RX_LEVEL` rms/maxAbs 0; `ROOM_MIXER_LEVEL` mixer_max_abs 0. No second `USER_TRANSCRIPT`. | Participant unmuted in meeting; mic working; track binding (see [AUDIO_DEBUGGING.md](AUDIO_DEBUGGING.md)). |
| **Receive path flakiness** | `health_contract_receive` pass: false, `WRONG_TRACK` or `NO_INBOUND_RTP`. `RECV_GATE_PASSED` may not fire. | Room audio can still reach Node and ASR can run; the receive gate is a health signal. See [FOLLOW_UP_DIALOGUE_STATUS_AND_TROUBLESHOOTING.md](FOLLOW_UP_DIALOGUE_STATUS_AND_TROUBLESHOOTING.md). |
| **Coordinator** | With multiple agents, only one gets the turn. If this agent is not allowed, no reply. | Logs: `requestTurn` and coordinator decision. Single-agent: coordinator still runs but grants the only agent. |
| **ASR / LLM / TTS** | `ASR_FAILED`, `LLM_FAILED`, or `TTS_FAILED` in logs; no `AGENT_REPLY`. | Credentials, model, and service availability for the provider in use. |

### 1.2 Log sequence for a follow-up turn (standard pipeline)

`VAD_END_OF_TURN` → `USER_TRANSCRIPT` → (if coordinator) turn granted → LLM → `AGENT_REPLY` → TTS.

No PersonaPlex events in this path.

### 1.3 Factors when testing or debugging (standard pipeline)

- **Single vs multi-agent:** With one agent and `COORDINATOR_URL` set, the coordinator still runs; `requestTurn` returns true after the collection window (only one agent in the bucket).
- **Receive gate:** `RECV_GATE_PASSED` means the bot is considered “hearing.” You can still get `USER_TRANSCRIPT` without a stable recv gate; the gate is a health signal, not a hard blocker for ASR.
- **Barge-in:** If the user speaks while the bot is speaking, the segment is queued and processed after the bot finishes (or cancels).

---

## 2. Optional: PersonaPlex backend

Only when `CONVERSATION_BACKEND=personaplex` is the PersonaPlex backend used. Then the turn flow is: VAD → ASR (for memory/coordinator) → coordinator (if set) → PersonaPlex (speech-to-speech). If PersonaPlex fails and `PERSONAPLEX_FALLBACK_TO_LLM=true`, the same turn falls back to the standard pipeline (LLM+TTS).

### 2.1 Coordinator and PersonaPlex fallback (fixed)

- **Symptom:** PersonaPlex times out or fails → fallback runs but no `AGENT_REPLY`.
- **Cause:** We had already been granted the turn; we never called `endTurn` because PersonaPlex threw. Fallback’s `requestTurn` then got `allowed: false`.
- **Fix:** Before calling the fallback path, we call `endTurn(userSafe.text, "")` so the turn is released and fallback can get the turn again. See `src/pipeline/orchestrator.ts`, `runTurnPersonaPlex` catch block.

### 2.2 What to verify when using PersonaPlex

- On timeout/error: `PERSONAPLEX_FAILED` → `PERSONAPLEX_FALLBACK_TO_LLM` → then `AGENT_REPLY` (with the coordinator fix above).
- Ensure ASR/LLM/TTS are configured if you rely on fallback.

---

## 3. E2E two-bot test (production-like)

- **Script:** `npm run e2e:two-bot` (or `node scripts/e2e-two-bot.js`).
- **Requires:** `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`, `USE_JITSI_BOT=true` in `.env.local`. For two distinct identities, set `E2E_BOT_B_PODIUM_TOKEN` for the second bot.
- **Standard pipeline:** Use e.g. `E2E_PRESET=prod-podcast` (both bots use ASR→LLM→TTS). No PersonaPlex involved.
- **Report:** `artifacts/e2e-two-bot-<ts>.json`; check `gates.TURN_GATE.ok` and `events.replyAt` to confirm at least one bot replied after transcript.

---

## 4. Commit 2533500 (Multi-agent Coordinator) – scope

That commit did **not** change room audio handling or receive contract logic. It added Whisper-local ASR, orchestrator/coordinator integration, and persona prompts. So standard-pipeline follow-up behavior is not tied to PersonaPlex or that commit’s scope.
