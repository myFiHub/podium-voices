# Live runbook – Podium Voices

Operator guide for running live sessions. See also [MVP_DEFINITION_OF_DONE.md](MVP_DEFINITION_OF_DONE.md) and [SMOKE_TEST_RUNBOOK.md](SMOKE_TEST_RUNBOOK.md).

---

## Before the session

1. **Token**
   - Confirm token is valid (see [TOKEN_ROTATION_SOP.md](TOKEN_ROTATION_SOP.md)). Rotate if needed; restart agent(s) after updating the secret.
2. **Agent join**
   - Start agent (or coordinator + agents). Confirm logs show `ROOM_JOINED` and no `AUTH_FAILURE`.
3. **Test line**
   - Join the outpost as a human, unmute, say a short line. Confirm `USER_TRANSCRIPT` and `AGENT_REPLY` in logs and that you hear TTS.
4. **Feedback buttons**
   - Trigger like/dislike or cheer/boo in the UI; speak again and confirm the next reply tone/length changes.
5. **Recording**
   - If you record, ensure capture is set (e.g. room recording or local capture). Know where clips will be exported.

---

## During the session

- **Latency:** Watch for `TURN_METRICS` (e.g. `end_of_user_speech_to_bot_audio_ms`). If latency spikes, consider restart or network check.
- **Restart if stuck:** If the bot stops responding or WS drops, restart the process (or rely on watchdog exit and orchestrator restart). Reconnect or restart should bring the agent back within ~60s.
- **Fallback topic:** If the conversation drifts or audience is cold, use a known `TOPIC_SEED` or scripted greeting for the next round.

---

## After the session

1. **Export 2–3 clips** (e.g. opener, one strong exchange, conclusion).
2. **Tag clips** for: **cheer pivot**, **boo reset**, **clean handoff** (multi-agent) so you can review what worked.
3. **Log top bugs** with reproduction steps (what you did, what you expected, what happened). Use logs and health/ready endpoints to answer *what happened, where it got slow, why it died*.
