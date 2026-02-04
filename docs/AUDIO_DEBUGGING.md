# Audio Debugging (Node ↔ bot page ↔ WebRTC)

This repo uses a Playwright-controlled "bot page" (`bot-page/`) to join Jitsi and publish/subscribe audio. When something is "silent", you want to avoid guessing and instead **prove each boundary**.

## The boundaries (prove in order)

- **B0 — TTS generation (Node)**: TTS adapter produces non-silent PCM.
- **B1 — Node → bot-page WebSocket**: bytes sent by Node match bytes received by the bot page.
- **B2 — Bot-page WebAudio output**: the synthetic mic graph produces non-silent samples.
- **B3 — WebRTC publication**: WebRTC is sending audio packets/bytes.
- **B4 — Human perception**: the human client hears the bot (speaker path).

Most failures are at B1–B3; B4 failures often mean client-side mute/volume/permissions.

## What "good" looks like (key signals)

- **Bridge frame contract**: 48 kHz, mono, s16le, 20 ms frames
  - 960 samples/frame
  - 1920 bytes/frame
- **Bot page stats** (periodic log, e.g. `BOT_PAGE_STATS_WARN`):
  - `tx_frame_max_abs > 0` and `tx_frame_nonzero > 0` while speaking → bot page is receiving non-silent TTS frames.
  - `tx_out_max_abs > 0` and `tx_out_nonzero > 0` → WebAudio output is non-silent (mic injection is working).
  - **`out_audio_bytes_sent` increases** over time while speaking → definitive proof WebRTC is publishing audio.
  - `pc_ice_state` / `pc_connection_state` should be non-empty (typically `connected`/`completed` and `connected`).

## Log output

- **`LOG_LEVEL=debug`** shows more events (e.g. Playwright WebSocket frames). To avoid huge dumps of zeros, **PW_WS_SENT** and **PW_WS_RECV** log only `payloadBytes` and `payloadType`, not the full buffer.
- **`LOG_FILE=path`** appends all logs to a file (creates parent dirs). Use when terminal scrollback is limited or you need to share a full debug run (e.g. `LOG_FILE=./logs/debug.log`).

## Turn on deep diagnostics

Run with:

```bash
LOG_LEVEL=info USE_JITSI_BOT=true DEBUG_AUDIO_FRAMES=1 SAVE_TTS_WAV=1 npm start
```

- **`DEBUG_AUDIO_FRAMES=1`**:
  - Node wraps each Node→browser frame as `[u32 seq LE][u8 xor][payload 1920 bytes]`.
  - Bot page responds with `frame_ack` containing `seq`, `xorHeader`, `xorComputed`, `maxAbs`, `nonZero`.
  - If `xorHeader !== xorComputed`, bytes were corrupted or truncated.
- **`SAVE_TTS_WAV=1`**:
  - Saves short WAV captures to `debug-audio/` so you can inspect with any audio player/editor.
  - Typical outputs:
    - `tts_node_tx_<ts>.wav`: what Node sent toward the bot page
    - `tts_page_rx_<ts>.wav`: what the bot page received over WS
    - `tts_page_out_<ts>.wav`: what WebAudio actually output to the synthetic mic graph

## Fast triage checklist

- **If `tx_frame_max_abs` is ~0**:
  - TTS is silent or frames are being zeroed before the bot page queues them.
  - Use `DEBUG_AUDIO_FRAMES=1` and compare `frame_ack.maxAbs` / `frame_ack.nonZero` vs Node's `BOT_TX_FRAME_SAMPLE`.
- **If `tx_frame_*` looks good but `tx_out_*` is ~0**:
  - WebAudio graph isn't running / callbacks not firing / jitter buffer drain bug.
  - Confirm the bot page reports increasing `mic_callbacks`, and that `audioContext` is running.
- **If `tx_out_*` looks good but `out_audio_bytes_sent` stays 0**:
  - You're not actually publishing over WebRTC (track disabled, conference not connected, ICE failure).
  - Check `pc_ice_state` / `pc_connection_state`.
  - Verify the bot isn't muted (the adapter toggles `nativeTrack.enabled`).
- **If `out_audio_bytes_sent` increases but the human hears nothing**:
  - Likely client-side (human muted, low volume, wrong output device), or conference routing issue.
  - Ask the human to verify they hear other humans, and that the bot participant is not locally muted.

## "Bot doesn't respond when I speak" (room audio in)

If the **greeting is heard** but the bot never replies to your speech, the failure is on **room audio in**: the bot isn't receiving your mic.

- **Check `rx_bytes`** in bot-page stats: it should **increase** while you speak (unmuted). If `rx_bytes` stays 0, the bot has no remote audio in the mixer.
- **Check logs for `BOT_REMOTE_TRACK_ADDED`**: when the bot attaches a remote participant's audio to the mixer, it sends this event. If you never see it, either no remote track was found or you're the only participant.
- **Ensure you're unmuted** in the meeting and that your client is actually sending audio.
- The bot now **attaches existing remote participants' audio** shortly after join (~1.2 s) and on **TRACK_ADDED** for participants who join later.

## When ROOM_AUDIO_RX_LEVEL is always 0 (silent at Node)

If you see **`BOT_RX_AUDIO_STARTED`** and **`BOT_REMOTE_TRACK_ADDED`** but **`ROOM_AUDIO_RX_LEVEL`** keeps reporting **rms: 0, maxAbs: 0**, the room audio **reaching Node** is silence. The bridge is receiving 20 ms frames from the browser, but the **content of those frames is zero**. So the problem is upstream of Node.

**What the logs convey:**

| Log / signal | Meaning |
|--------------|--------|
| `BOT_RX_AUDIO_STARTED` | The bot page received at least one frame from its mixer and sent it to Node. |
| `ROOM_AUDIO_RX_LEVEL` rms/maxAbs = 0 | The last 5 seconds of room audio **at Node** (after resample) are all zeros. So the mixer is sending silence. |
| `ROOM_MIXER_LEVEL` mixer_max_abs = 0 | The **browser** mixer output (last frame before sending) is zero → the remote participant's track is silent in the bot's browser. |

**Plan to get things working:**

1. **Check `ROOM_MIXER_LEVEL`** (logged about every 10 s from bot-page stats).  
   - **If `mixer_max_abs` is 0:** The remote track in the bot's browser is silent. The human is either **muted in the meeting**, or their **mic is not working / not selected**.  
   - **If `mixer_max_abs` > 0** but `ROOM_AUDIO_RX_LEVEL` is still 0: Something is wrong on the bridge (binary frames not reaching Node or wrong format). This is rare.

2. **Human must be unmuted and mic working.**  
   In the Podium/Jitsi meeting UI, the participant must **unmute** and speak. They should confirm another participant (or the same client in another tab) can hear them. Check browser mic permissions and selected device.

3. **After unmuting:** Restart the bot if needed, have the human speak clearly for a few seconds, then check logs again. You should see **`ROOM_MIXER_LEVEL` mixer_max_abs > 0** and **`ROOM_AUDIO_RX_LEVEL` rms/maxAbs > 0**. Then VAD can detect speech and the pipeline can produce `VAD_END_OF_TURN` and `USER_TRANSCRIPT`.

4. When room audio at Node is non-zero, follow **"Next steps when room audio in is working but the bot never replies"** (VAD/ASR tuning).

**If humans hear each other but the bot's mixer stays 0:** The bot now tries multiple ways to get the remote audio stream (getStream(), getOriginalStream(), or the underlying MediaStreamTrack), enables the track if it was disabled, and logs `track_readyState` / `track_enabled` on `BOT_REMOTE_TRACK_ADDED`. Check those fields (e.g. `readyState: "live"`, `enabled: true`). If the track is live and enabled but the mixer is still silent, the issue is likely **Headless Chrome + WebRTC** (remote track data not delivered into Web Audio in headless mode). **Recommended fix:** run the bot in **headed mode** with a virtual display (e.g. Xvfb). Set `BROWSER_HEADED=true` in `.env.local` and run under Xvfb on Linux; see **`docs/HEADED_BROWSER.md`** for the decision tree, Xvfb usage, and scaling notes.


## Next steps when room audio in is working but the bot never replies

If **human-to-human audio works** in the room and the bot is present, and logs show `BOT_RX_AUDIO_STARTED`, `rx_bytes` increasing, and `BOT_REMOTE_TRACK_ADDED`, but **no `VAD_END_OF_TURN`** and **no `USER_TRANSCRIPT`**, the pipeline is getting room audio but VAD/ASR is not producing a turn.

1. **Check `ROOM_AUDIO_RX_LEVEL`** — Every 5 seconds the bridge logs the RMS and maxAbs of the last 5s of room audio **at Node**. If **rms and maxAbs are near 0** while you speak, the mixer or path to Node is effectively silent (fix mic/levels or mixer). If **rms/maxAbs are non-zero** but you still get no VAD events, lower the VAD sensitivity (see step 3).
2. **Confirm humans hear the bot** — After the greeting, can attendees hear it? If not, check client mute/volume; `out_audio_bytes_sent` in logs confirms the bot is sending.
3. **Trigger VAD with a clear pause** — Say a short phrase (e.g. "Hello, can you hear me?") then **stay silent for at least 1 second**. Watch for: **`VAD_SPEECH_STARTED`** (debug) = first speech detected; **`VAD_END_OF_TURN`** = pause long enough; **`USER_TRANSCRIPT`** = ASR text; then the bot should reply.
4. **No `VAD_SPEECH_STARTED`** — Audio may be too quiet at Node. Run with `LOG_LEVEL=debug`; ensure unmuted and close to mic. **Tune VAD:** set **`VAD_ENERGY_THRESHOLD`** lower (e.g. `300` or `200`) for quieter mics (energy-based fallback when webrtcvad is not used), or **`VAD_AGGRESSIVENESS=0`** if using the webrtcvad native module (0 = least aggressive, more sensitive).
5. **`VAD_SPEECH_STARTED` but no `VAD_END_OF_TURN`** — Pause longer after speaking (at least 0.5–1 s); increase **`VAD_SILENCE_MS`** if your natural pauses are longer.
6. **`VAD_END_OF_TURN` but no `USER_TRANSCRIPT`** — Check for `ASR_FAILED` in logs; verify ASR config and safety gate.
7. **`WATCHDOG_WS_UNHEALTHY`** — The Podium WebSocket to the outpost server closed (e.g. idle timeout). Stop and run `npm start` again; longer term add reconnect or increase server idle timeout.

## Notes on common gotchas we've already handled

- **Burst sending TTS frames** can overflow the jitter buffer. Node now uses a paced sender (one 20 ms frame every 20 ms).
- **WebSocket buffer lifetime** can lead to silent frames if you create typed array views over a reused/detached `ArrayBuffer`. The bot page copies frames into a stable aligned buffer before creating `Int16Array` views.
- **P2P instability**: the bot page disables Jitsi P2P to reduce "session-initiate" timeouts.

## Common Jitsi / lib-jitsi-meet console warnings (bot page)

These appear in `BOT_CONSOLE` logs from the Playwright bot. Most are benign or environment-dependent.

- **"getting turn credentials failed" / "is mod_turncredentials or similar installed and configured?"**  
  The Jitsi server did not provide TURN credentials (e.g. `mod_turncredentials` or equivalent not configured). **When it matters:** TURN is required when participants are behind symmetric NAT or strict firewalls; without it, ICE may still succeed using STUN and host candidates on simple networks. If the bot joins and you see `pc_connection_state: "connected"` and `out_audio_bytes_sent` increasing, audio is working. If the bot consistently fails to connect in production, configure TURN on your Jitsi/prosody side and ensure the bot uses the same JVB/domain config that receives TURN credentials.

- **"The ScriptProcessorNode is deprecated. Use AudioWorkletNode instead."**  
  The bot page currently uses `ScriptProcessorNode` for the synthetic mic and mixer. This is known and works; a future change will migrate to `AudioWorkletNode` for better performance and to avoid deprecation warnings.

- **"Analytics disabled, disposing"** / **"The description does not look like plan-b"** / **"P2P mode disabled"**  
  Benign Jitsi/lib-jitsi-meet messages. No action needed.

- **"invalid session id"** (strophe.jingle)  
  Can occur during Jingle renegotiation or when P2P is rejected. Often harmless if the conference stays joined and audio continues.

- **AudioOutputProblemDetector: "local audio levels: [null,null], remote audio levels: undefined"**  
  Jitsi's stats layer may report this for headless participants. If the bot is sending and receiving (e.g. `out_audio_bytes_sent` and `rx_bytes` increasing), it can be ignored.

## BOT_PAGE_STATS_WARN behavior

Warnings are **suppressed** for the first 30 seconds after the bot joins the Jitsi conference (ICE/connection ramp-up). They are also **not** raised for "silent current frame" conditions when the outbound path is clearly healthy: `out_audio_bytes_sent >= 50000` and `pc_connection_state === "connected"` (e.g. between TTS utterances the current frame can be silent). Critical conditions (conference not joined, audio context not running, ICE failed/disconnected, or Node sent TTS but the page received 0 bytes) always trigger a warning when outside the grace period.
