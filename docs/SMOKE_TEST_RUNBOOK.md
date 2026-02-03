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

## 4. Automated smoke script (optional)

Run the smoke script to start the process for a fixed duration and check logs for transcript and reply:

```bash
USE_JITSI_BOT=true npm run smoke
# Or with custom duration (minutes): node scripts/smoke.js 5
```

See `scripts/smoke.js` for duration (default 2 minutes) and pass/fail criteria (USER_TRANSCRIPT and AGENT_REPLY in logs). The script exits 0; it reports PASS when both events were seen.
