# Smoke Test Runbook (Staging + Production)

Repeatable staging and smoke tests for the AI co-host with browser bot (real Jitsi audio).

## Prerequisites

- Staging outpost: create or use a dedicated outpost UUID for repeated tests. Creator or cohost must be the test user.
- Environment: `PODIUM_TOKEN`, `PODIUM_OUTPOST_UUID`, `USE_JITSI_BOT=true`, and ASR/LLM/TTS keys set (or stubs).
- Opener/greeting: for a generated storyteller opener, set `OPENER_ENABLED=true` (default). To force a fixed greeting instead, set `GREETING_TEXT="..."`. To disable both, set `GREETING_TEXT=` and `OPENER_ENABLED=false`.
- Bot page: with `USE_JITSI_BOT=true`, Node serves `bot-page/` on the bridge port (default starts at 8766); no `BOT_PAGE_URL` needed unless you host the page elsewhere.
- Playwright: install Chromium if not already present: `npx playwright install chromium`.
- Jitsi lib: the bot page loads lib-jitsi-meet from your Jitsi domain (e.g. `https://<outpost_host_url>/libs/lib-jitsi-meet.min.js`). If your deployment uses a different URL or JWT auth, extend the join config in `bot-page/bot.js` and `src/room/jitsi-browser-bot.ts`.

## 1. Two-account smoke test (manual)

1. Start the co-host: `LOG_LEVEL=debug USE_JITSI_BOT=true npm start`
2. From the Podium web app, join the same outpost as a second user (human).
3. Unmute and speak a known phrase (e.g. "Hello, can you hear me?").
4. Verify in co-host logs:
   - `USER_TRANSCRIPT` with non-zero text length
   - `AGENT_REPLY` with non-zero text length
5. Verify the human hears the bot’s TTS in the room.

### 1.1 Reaction events smoke (cheer/boo/like/dislike)

Purpose: validate “in-room stimuli” integration (Podium reaction WS events → feedback register → prompt/tone).

1. Ensure the bot is running in a real outpost (`USE_JITSI_BOT=true`) and you can hear it reply normally.
2. From the Podium UI, send one of the reactions:
   - **Like** / **Dislike**
   - **Cheer** / **Boo**
   - (WS detail) These arrive as `user.liked` / `user.disliked` / `user.cheered` / `user.booed` with `data.react_to_user_address` as the target.
3. After the reaction, speak a short line to trigger another bot response.
4. Expected behavior:
   - On positive reactions (like/cheer), the next bot reply should trend **more upbeat / affirming**.
   - On negative reactions (dislike/boo), the next bot reply should **de-escalate** (shorter, clarifying, change topic, or ask a question).
5. Optional: set `FEEDBACK_REACT_TO_ADDRESS=self` to count **only reactions targeting the bot**, rather than overall room mood.

**If you don’t hear TTS, immediately check WebRTC “publish proof”:**

- Look for periodic bot-page stats logs (e.g. `BOT_PAGE_STATS_WARN`).
- Verify:
  - `pc_ice_state` is non-empty (typically `connected`/`completed`)
  - `pc_connection_state` is non-empty (typically `connected`)
  - **`out_audio_bytes_sent` increases over time** while the bot is speaking (this is the definitive “audio is being sent” signal)

## 2. Audio loop sanity checks

- **During human speech**: Ensure remote audio is non-zero (e.g. `rx_bytes` or rx_rms in bot stats / logs). If you add `getStats()` polling from Node, assert `rx_rms > threshold` during speech.
- **During silence**: `rx_rms` (or equivalent) should be below a low threshold.
- **No self-echo**: When only the bot is speaking, verify the bot’s own participant is excluded from the mix (no large rx spike attributable only to the bot). The bot page mixes only remote tracks and excludes the local participant.

## 2.1 Contract verification knobs (deep diagnostics)

When debugging “no audio” issues, enable these knobs to confirm each boundary:

- **`DEBUG_AUDIO_FRAMES=1`**: Adds a per-frame header on Node→browser TTS frames and logs browser `frame_ack` acks. This proves the browser sees the same bytes Node sent.
- **`SAVE_TTS_WAV=1`**: Saves short WAV captures under `debug-audio/` to inspect what was actually produced/received/output.

Example:

```bash
LOG_LEVEL=info DEBUG_AUDIO_FRAMES=1 SAVE_TTS_WAV=1 USE_JITSI_BOT=true npm start
```

## 3. Reconnect / resume test

1. Run the co-host for at least 10 minutes with a human occasionally speaking.
2. Force a reconnect: stop the process (SIGINT), then restart: `USE_JITSI_BOT=true npm start` (same outpost).
3. Assert the bot rejoins and produces an audible reply within 60 seconds after the human speaks again.

## 4. Bot dropped from call (you're alone in the room)

If the bot participant disappears from the outpost and you see yourself alone in the room (and you did **not** stop the Node process):

1. **Check the terminal** where `npm start` is running:
   - **`BOT_BRIDGE_DISCONNECTED`** — The browser’s WebSocket to Node closed (page closed, crash, or Jitsi/network caused the page to go away). The bot has left the call from the room’s perspective.
   - **`BOT_PAGE_CLOSED`** — The Playwright bot page (browser tab) closed or crashed.
   - **`BOT_PAGE_ERROR_DETAIL`** / **`BOT_PAGE_UNHANDLED_REJECTION`** — A JS error may have preceded the drop.

2. **Get the bot back:**
   - Stop the process if it’s still running (Ctrl+C).
   - Start again: `USE_JITSI_BOT=true npm start` (same `PODIUM_OUTPOST_UUID` and `PODIUM_TOKEN`).
   - In the Podium web app, stay in (or rejoin) the same outpost; the bot will rejoin as a new participant.

3. **If the bot keeps dropping:** Check Jitsi/server logs (e.g. Prosody, JVB) for kicks or connection timeouts. Jitsi warnings in the bot console (e.g. “invalid session id”, “description does not look like plan-b”, “AudioOutputProblemDetector”) can precede a teardown; improving network/TURN or server config may reduce drops.

## 5. Automated smoke script (optional)

Run the smoke script to start the process for a fixed duration and check logs for transcript and reply:

```bash
USE_JITSI_BOT=true npm run smoke
# Or with custom duration (minutes): node scripts/smoke.js 5
```

See `scripts/smoke.js` for duration (default 2 minutes) and pass/fail criteria (USER_TRANSCRIPT and AGENT_REPLY in logs). The script exits 0; it reports PASS when both events were seen.

---

**Quick reference — log events when the bot leaves the call:**

| Event | Meaning |
|-------|--------|
| `BOT_BRIDGE_DISCONNECTED` | Bridge WebSocket closed; bot is no longer in the room. Restart process to rejoin. |
| `BOT_PAGE_CLOSED` | Bot browser page closed or crashed. Restart process to rejoin. |
