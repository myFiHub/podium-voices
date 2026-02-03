# Audio Debugging (Node ↔ bot page ↔ WebRTC)

This repo uses a Playwright-controlled “bot page” (`bot-page/`) to join Jitsi and publish/subscribe audio. When something is “silent”, you want to avoid guessing and instead **prove each boundary**.

## The boundaries (prove in order)

- **B0 — TTS generation (Node)**: TTS adapter produces non-silent PCM.
- **B1 — Node → bot-page WebSocket**: bytes sent by Node match bytes received by the bot page.
- **B2 — Bot-page WebAudio output**: the synthetic mic graph produces non-silent samples.
- **B3 — WebRTC publication**: WebRTC is sending audio packets/bytes.
- **B4 — Human perception**: the human client hears the bot (speaker path).

Most failures are at B1–B3; B4 failures often mean client-side mute/volume/permissions.

## What “good” looks like (key signals)

- **Bridge frame contract**: 48 kHz, mono, s16le, 20 ms frames
  - 960 samples/frame
  - 1920 bytes/frame
- **Bot page stats** (periodic log, e.g. `BOT_PAGE_STATS_WARN`):
  - `tx_frame_max_abs > 0` and `tx_frame_nonzero > 0` while speaking → bot page is receiving non-silent TTS frames.
  - `tx_out_max_abs > 0` and `tx_out_nonzero > 0` → WebAudio output is non-silent (mic injection is working).
  - **`out_audio_bytes_sent` increases** over time while speaking → definitive proof WebRTC is publishing audio.
  - `pc_ice_state` / `pc_connection_state` should be non-empty (typically `connected`/`completed` and `connected`).

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
  - Use `DEBUG_AUDIO_FRAMES=1` and compare `frame_ack.maxAbs` / `frame_ack.nonZero` vs Node’s `BOT_TX_FRAME_SAMPLE`.
- **If `tx_frame_*` looks good but `tx_out_*` is ~0**:
  - WebAudio graph isn’t running / callbacks not firing / jitter buffer drain bug.
  - Confirm the bot page reports increasing `mic_callbacks`, and that `audioContext` is running.
- **If `tx_out_*` looks good but `out_audio_bytes_sent` stays 0**:
  - You’re not actually publishing over WebRTC (track disabled, conference not connected, ICE failure).
  - Check `pc_ice_state` / `pc_connection_state`.
  - Verify the bot isn’t muted (the adapter toggles `nativeTrack.enabled`).
- **If `out_audio_bytes_sent` increases but the human hears nothing**:
  - Likely client-side (human muted, low volume, wrong output device), or conference routing issue.
  - Ask the human to verify they hear other humans, and that the bot participant is not locally muted.

## Notes on common gotchas we’ve already handled

- **Burst sending TTS frames** can overflow the jitter buffer. Node now uses a paced sender (one 20 ms frame every 20 ms).
- **WebSocket buffer lifetime** can lead to silent frames if you create typed array views over a reused/detached `ArrayBuffer`. The bot page copies frames into a stable aligned buffer before creating `Int16Array` views.
- **P2P instability**: the bot page disables Jitsi P2P to reduce “session-initiate” timeouts.

