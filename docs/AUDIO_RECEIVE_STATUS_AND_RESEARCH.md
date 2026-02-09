# Room Audio In: Status Report & Research Brief

**Purpose:** Document the current state of “bot doesn’t hear human” and outline alternative approaches to investigate, assuming **headed vs headless is not the root cause**.

---

## 1. Problem Statement

- **Observed in:** Both headless and headed Chromium (Playwright)reat headless/headed as **not** the deciding factor for this report.

---

## 2. Technical Context

| Layer | Technology |
|-------|------------|
| Conference | Jitsi (lib-jitsi-meet), Colibri/JVB, no P2P |
| Bot runtime | Node.js, Playwright (Chromium) |
| Bot page | Single page loads lib-jitsi-meet, joins room, replaces local mic with synthetic PCM from Node over WebSocket |
| Room audio in | Remote participant audio → `RTCPeerConnection` receivers → `MediaStreamTrack` → `AudioContext.createMediaStreamSource(stream)` → AnalyserNode → GainNode → ScriptProcessorNode (mixer) → PCM to Node over WebSocket |
| Diagnostics | `getStats()` (inbound-rtp bytesReceived), pre-mixer AnalyserNode (getFloatTimeDomainData), post-mixer maxAbs, truth probes every ~2s, BOT_DIAG verdict + `*_stats.jsonl` |

**Relevant code paths:**

- **bot-page/bot.js:** `addRemoteTrackToMixer()` — resolves `receiver.track` via `getReceiverTrackById()` (or Jitsi track), then `createMediaStreamSource(stream)` with that track, then source → analyser → mixerGain → mixerProcessor → WebSocket.
- **Node:** Consumes 48 kHz mono 20 ms PCM from the bridge; VAD/ASR run on that stream.

---

## 3. What We Have Verified (Evidence)

- **Inbound RTP is present:** `RTCPeerConnection.getStats()` reports an `inbound-rtp` audio row with **`bytesReceived`** (and `packetsReceived`) **increasing** while a human speaks. In logs: `audio_inbound_bytes_delta` and `audio_inbound_packets_delta` are non-zero (e.g. 4378 bytes, 52 packets per 2s window).
- **Track identity is correct:** We bind the **receiver’s** `MediaStreamTrack` (`pc.getReceivers()` → `receiver.track`) to the mixer, not the Jitsi wrapper. Logs show `BOT_RECEIVER_TRACK_USED` and in `*_stats.jsonl`: `premixer_bindings[].boundVia === "receiver"`, `boundTrackId` === `audio_inbound_track_identifier` (same track id as the one with increasing RTP).
- **Transceivers align:** The inbound RTP is associated with a recvonly audio transceiver (mid "2"); `receiver_tracks` in stats lists that track (same id), `readyState: "live"`, and later `muted: false`.
- **Web Audio graph exists and is “running”:** `audio_context_state === "running"`, and the mixer’s ScriptProcessor fires (we see `BOT_RX_AUDIO_STARTED` and frames sent to Node). So the graph is being pulled.
- **Pre-mixer is silent:** An AnalyserNode placed **immediately after** `createMediaStreamSource(stream)` (the stream contains only the receiver track) reports **maxAbs 0** on every truth probe, even when `audio_inbound_bytes_delta` is large.
- **Post-mixer is silent:** The mixer output (and thus Node-side room audio) is zero; `ROOM_MIXER_LEVEL` and `ROOM_AUDIO_RX_LEVEL` are 0.

So: **RTP is received by the PC and attributed to a specific receiver track; we connect that exact track to a MediaStreamSource → Analyser → mixer; the Analyser and mixer output remain zero.** The disconnect is between “RTP decoded for that track” and “samples delivered to the Web Audio node fed by that track.”

---

## 4. What We Have Ruled Out (For This Report)

- **Wrong track / wrapper track:** We explicitly use `getReceiverTrackById()` and log `boundVia` and `boundTrackId`; they match the inbound RTP track id. So we are not mixing a different (e.g. Jitsi wrapper) track.
- **Headless vs headed as the fix:** We assume headed is not the solution; the same “inbound RTP but pre-mixer 0” behavior is in scope regardless of headless/headed.
- **No inbound RTP / wrong PC:** getStats() shows increasing bytes on the same PC we use for getReceivers(); the track id in stats matches the receiver track we bind.
- **AudioContext suspended:** We resume when suspended; probes show `audio_context_state: "running"`.
- **Mixer not pulling:** ScriptProcessor fires and sends frames to Node; the issue is that the **content** of those frames is silence because the remote source branch never produces non-zero samples.

---

## 5. Likely Failure Point (Narrowed)

The most consistent explanation is:

**Decoded RTP audio for the remote receiver track is not being delivered into the `MediaStreamAudioSourceNode` (or the node never outputs non-zero samples) in our environment.**

Possible mechanisms (to be validated by research):

1. **Chrome/Chromium behavior:** The internal path from `RTCRtpReceiver` → decoded frames → `MediaStreamTrack` → `MediaStreamAudioSourceNode` may not push data in certain configurations (e.g. no “consumer” that the implementation treats as real playback, or a code path that only runs when the track is attached to a “displayed” or “played” output).
2. **MediaStreamSource + remote track:** Some implementations may only feed a remote `MediaStreamTrack` into Web Audio when the track is also attached to an audio element or a destination that is “audible” in the implementation’s view.
3. **Timing / first-frame:** The first decoded frames might be dropped or never scheduled into the graph until some other condition is met (e.g. user gesture, visibility, or destination type).
4. **Jitsi/Colibri specifics:** Unlikely to change the above, but Jitsi could replace or re-create tracks in a way that leaves our source connected to a track that no longer receives decoded data (we already rebind by receiver and by mid; binding looks correct in logs).

---

## 6. Alternative Approaches to Research

Use the following as a research map; each has been used elsewhere to get “remote WebRTC audio into a processing pipeline” when the default path is silent.

### 6.1 Web Audio: Force “consumption” of the track

- **Idea:** Some browsers only feed a remote track into Web Audio when they consider it “played.” Try connecting the same stream to an `HTMLAudioElement` (or an `AudioContext.destination`) in addition to the analyser/mixer, possibly with `volume = 0` or a muted element, so the implementation treats the track as consumed.
- **Search terms:** `createMediaStreamSource` remote track silent, `MediaStreamAudioSourceNode` WebRTC no data, WebRTC receive track Web Audio silent, “remote track” “web audio” zero.

#### Resolution (workaround applied)

We now implement the **muted media-element “consumer” workaround** in the bot page:

- In [`bot-page/bot.js`](bot-page/bot.js), whenever we bind a remote receiver track to Web Audio via `audioContext.createMediaStreamSource(streamForSource)`, we also attach `streamForSource` to a hidden, muted `Audio()` element and call `play()`.\n- This forces Chromium to decode inbound RTP into PCM so the existing Web Audio path (pre-mixer analyser → mixer → bridge) sees non-zero samples.\n- The consumer is stored per binding and disposed on rebinding to avoid leaks.\n+
This aligns with the long-standing Chromium behavior (bug 933677 class) where remote WebRTC audio may not flow into Web Audio unless also rendered/consumed by a media element.

### 6.2 Insertable Streams (replace track path)

- **Idea:** Use **Insertable Streams** (formerly “WebRTC Encoded Transform”) on the **receiver** side to get encoded (or decoded) frames in a worker and bypass the default `MediaStreamTrack` → Web Audio path. Then decode (if needed) and push PCM into an `AudioWorklet` or the main thread and feed your mixer.
- **Search terms:** Insertable Streams receive, `RTCRtpReceiver` `transform` encoded frames, WebRTC receive insertable streams decode, “getParameter” “insertableStreams” receiver.

### 6.3 Capture at RTP/decoder level (native or server)

- **Idea:** Avoid relying on the browser’s delivery of decoded audio to Web Audio. Options:
  - **Server-side:** JVB or a media server (e.g. Jitsi Videobridge, Mediasoup, Pion) sends/receives RTP; a bot process subscribes to the participant’s audio stream and gets PCM (or decoded frames) on the server. No browser Web Audio for receive.
  - **Native / Node bindings:** Use a native WebRTC stack (e.g. libwebrtc, Pion) in Node or via addon to receive RTP, decode, and send PCM to the same pipeline the bot uses today. Browser is then only for sending (or not used for receive at all).
- **Search terms:** Jitsi JVB audio stream server-side, Mediasoup receive track Node, Pion Go WebRTC receive audio, libwebrtc Node receive.

### 6.4 AudioWorklet instead of ScriptProcessor

- **Idea:** We currently use a **ScriptProcessorNode** for the mixer (deprecated). Replace with an **AudioWorklet** that pulls from a source fed by the remote track. Some browsers might schedule or process worklets differently and could expose samples that never appear at a ScriptProcessor.
- **Search terms:** AudioWorkletNode remote MediaStreamTrack, replace ScriptProcessor WebRTC receive, AudioWorklet getFloatTimeDomainData alternative.

### 6.5 Second AudioContext or “dummy” destination

- **Idea:** Create a second AudioContext or connect the remote track’s source to `audioContext.destination` (or a GainNode at 0) in addition to the analyser/mixer, so the engine has a “real” destination and may start pushing decoded data.
- **Search terms:** Web Audio MediaStreamSource no output without destination, connect destination 0 gain remote track.

### 6.6 getStats() vs actual playback

- **Idea:** Confirm whether `bytesReceived` can increase while the decoded path to Web Audio is never used (e.g. decoder runs for stats/jitter buffer but not for MediaStreamTrack output). Look for Chrome bugs or design notes on when decoded frames are written to the track.
- **Search terms:** Chrome WebRTC receiver decoded frames MediaStreamTrack, getStats bytesReceived but no audio output, Chromium RTCRtpReceiver decode output.

### 6.7 Jitsi / lib-jitsi-meet receive path

- **Idea:** See how Jitsi’s own UI gets remote audio for playback (and for level meters). If they use a different path (e.g. direct element, or a specific API), we might mirror it for the bot’s receive chain.
- **Search terms:** lib-jitsi-meet remote track audio element, Jitsi Meet receive audio playback, JitsiConference getRemoteTrack audio.

### 6.8 Chrome flags / command-line

- **Idea:** Check whether any Chromium flags enable or disable a code path that feeds decoded RTP into MediaStreamTrack/Web Audio (e.g. related to hardware decoding, or “ignore” flags for background tabs).
- **Search terms:** Chromium flags WebRTC decode, Chrome command line Web Audio MediaStream, Playwright Chromium args WebRTC.

---

## 7. Diagnostic Artifacts (For Sharing or Re-runs)

- **Truth probes:** Every ~2s the bot sends a `truth_probe` with `audio_inbound_*`, `pre_mixer_max_abs`, `pre_mixer_by_track_id`, `premixer_bindings`, `receiver_tracks`, `audio_context_state`, etc.
- **BOT_DIAG:** With `BOT_DIAG=1`, the process runs ~20s, writes `./logs/diag/<conf>_<session>_stats.jsonl`, and exits with a verdict (e.g. `INBOUND_RTP_BUT_PREMIX_SILENT`).
- **Key fields in `*_stats.jsonl`:**
  - `audio_inbound_bytes_delta`, `audio_inbound_packets_delta`, `audio_inbound_track_identifier`, `inbound_mid`
  - `pre_mixer_max_abs`, `pre_mixer_by_track_id`, `post_mixer_max_abs`
  - `premixer_bindings`: `participantId`, `requestedTrackId`, `boundTrackId`, `boundVia`, `pre_mixer_max_abs`
  - `receiver_tracks`: `id`, `kind`, `muted`, `readyState`
  - `audio_context_state`, `audio_transceivers`

These allow anyone to confirm “inbound RTP present, correct receiver track bound, pre-mixer still 0” without re-running the app.

---

## 8. Summary Table

| Question | Answer |
|----------|--------|
| Is RTP arriving at the bot’s PC? | Yes (`bytesReceived` / `audio_inbound_bytes_delta` increase). |
| Are we mixing the right track? | Yes (receiver track, id matches `audio_inbound_track_identifier`). |
| Is the Web Audio graph running? | Yes (`audio_context_state: "running"`, mixer sends frames). |
| Where does the chain break? | Between “decoded RTP for that track” and “samples at MediaStreamAudioSourceNode output.” |
| Headed vs headless? | Treated as not the fix for this report. |
| Next steps for research? | See §6: force consumption, Insertable Streams, server-side/native receive, AudioWorklet, dummy destination, Chrome/Jitsi internals, flags. |

---

## 9. References in This Repo

- **docs/AUDIO_DEBUGGING.md** — General audio debugging, truth probes, contracts, interpreting `INBOUND_RTP_BUT_PREMIX_SILENT`.
- **bot-page/bot.js** — `addRemoteTrackToMixer`, `getReceiverTrackById`, `getReceiverTrackByMid`, `rebindMixerToReceiverTrack`, truth probe and premixer_bindings/receiver_tracks.
- **src/room/jitsi-browser-bot.ts** — Bridge, BOT_DIAG, verdict logging, truth_probe handling.

---

*Document generated for research on solutions when “correct receiver track + inbound RTP” still yields silent pre-mixer/post-mixer in the browser.*
