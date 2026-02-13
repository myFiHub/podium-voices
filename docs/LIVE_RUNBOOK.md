# Live runbook – Podium Voices

Operator guide for running live sessions. For humans and A.I. agents. See also [MVP_DEFINITION_OF_DONE.md](MVP_DEFINITION_OF_DONE.md) and [SMOKE_TEST_RUNBOOK.md](SMOKE_TEST_RUNBOOK.md).

---

## Before the session

1. **Token**
   - Confirm token is valid (see [TOKEN_ROTATION_SOP.md](TOKEN_ROTATION_SOP.md)). Rotate if needed; restart agent(s) after updating the secret.
2. **Agent join**
   - **Docker single-agent:** `docker compose --env-file .env.local up -d` then `docker compose logs -f podium-voices-agent`.
   - **Docker multi-agent:** `docker compose --profile multi-agent --env-file .env.local up -d podium-voices-multi-agent` then `docker compose --profile multi-agent logs -f podium-voices-multi-agent`.
   - **Local (no Docker):** Start coordinator then each agent (see [MULTI_AGENT_PHASE1.md](MULTI_AGENT_PHASE1.md)).
   - Confirm logs show `ROOM_JOINED` and no `AUTH_FAILURE`; for Jitsi bot, `BOT_JS_LOADED` and `HTTP_UPGRADE` for `/bridge`.
3. **Test line**
   - Join the outpost as a human, unmute, say a short line. Confirm `USER_TRANSCRIPT` and `AGENT_REPLY` in logs and that you hear TTS.
4. **Feedback buttons**
   - Trigger like/dislike or cheer/boo in the UI; speak again and confirm the next reply tone/length changes.
5. **Recording**
   - If you record, ensure capture is set (e.g. room recording or local capture). Know where clips will be exported.

---

## During the session

- **Latency:** Watch for `TURN_METRICS` (e.g. `end_of_user_speech_to_bot_audio_ms`). If latency spikes, consider restart or network check.
- **Restart if stuck:** If the bot stops responding or WS drops, restart the process (or rely on watchdog exit and orchestrator restart). **Docker:** `docker compose --env-file .env.local restart podium-voices-agent` or `docker compose --profile multi-agent --env-file .env.local restart podium-voices-multi-agent`. Reconnect or restart should bring the agent back within ~60s.
- **Fallback topic:** If the conversation drifts or audience is cold, use a known `TOPIC_SEED` or scripted greeting for the next round.

---

## After the session

1. **Export 2–3 clips** (e.g. opener, one strong exchange, conclusion).
2. **Tag clips** for: **cheer pivot**, **boo reset**, **clean handoff** (multi-agent) so you can review what worked.
3. **Log top bugs** with reproduction steps (what you did, what you expected, what happened). Use logs and health/ready endpoints to answer *what happened, where it got slow, why it died*.
