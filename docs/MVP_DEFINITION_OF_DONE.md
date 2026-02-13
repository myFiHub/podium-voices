# MVP Definition of Done

This document is the single source of truth for what "MVP launch" means for Podium Voices. Operators and CI should align on these criteria before public or repeatable live sessions.

---

## In scope (MVP experience)

Users should consistently experience:

1. **Reliable join**  
   An AI co-host joins a specific Podium Outpost reliably (REST + WebSocket + Jitsi when configured).

2. **5–20 minute high-quality segment** with:
   - **Low overlap, clean turn-taking**; barge-in works (user speech during bot reply cancels TTS and allows new turn).
   - **Clear opener and topic framing.** MVP default is **opener-first**: set `GREETING_TEXT=` (empty), `OPENER_ENABLED=true`, `OPENER_DELAY_MS=500–1500`, and use `TOPIC_SEED` for coherence. Alternatively use a scripted cold open (Pattern B) with `GREETING_TEXT` set and `OPENER_ENABLED=false`.
   - **Audience feedback (cheer/boo/like/dislike) changes behavior** in a noticeable way (tone, length, topic pivot when negative).
   - **Time budgets enforced** (no runaway monologues; speaking time and `user.time_is_up` respected).

3. **Self-recovery or clear fail**  
   When something breaks, the system either self-recovers (e.g. WS reconnect, process restart by orchestrator) or fails clearly and restarts quickly so operators can restore service.

4. **Telemetry**  
   Enough structured logs and (where implemented) health endpoints to answer: *what happened, where it got slow, and why it died.*

---

## Out of scope (non-goals for MVP)

- **Fully autonomous token refresh** without any operator involvement. Manual or semi-automated token rotation with restart is acceptable.
- **Perfect 30–60 minute coherence** without summarization or retrieval. MVP centers on short, repeatable segments (e.g. 5–20 min); longer sessions may drift until running summary or retrieval is in place.
- **Deterministic "hard policy" moderation** beyond simple safety (e.g. content filters) and time gating. Feedback drives prompt and light policy (e.g. shorter replies on high_negative), not hard blocks.

---

## Preflight checklist (before each public session)

Run these checks so the session meets the definition of done:

- [ ] Single agent: 5-minute topic run (manual or smoke script); agent joins, speaks opener, responds to speech.
- [ ] Single agent with heavy audience reactions: trigger cheer/boo; confirm next reply tone changes.
- [ ] Multi-agent (if used): coordinator + 2 agents, ~10-minute debate; turn-taking and no overlap.
- [ ] Network blip: simulate WS disconnect; confirm reconnect or process restart and recovery.
- [ ] Token invalid: confirm failure mode (e.g. AUTH_FAILURE or join failure) and that alerting would fire.

See [SMOKE_TEST_RUNBOOK.md](SMOKE_TEST_RUNBOOK.md) for detailed steps and [TOKEN_ROTATION_SOP.md](TOKEN_ROTATION_SOP.md) for token validation.
