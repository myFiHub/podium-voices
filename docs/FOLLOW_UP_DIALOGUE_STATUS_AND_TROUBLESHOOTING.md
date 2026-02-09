# Follow-Up Dialogue: Status, Fix, and Troubleshooting

**Purpose:** Shareable summary of the current status of bot–bot (or bot–human) follow-up conversation, why the receive-path fix was applied, how it was implemented, and how to debug if issues continue. This applies to the **standard pipeline** (ASR→LLM→TTS). When using the optional PersonaPlex backend, see also [FOLLOW_UP_ISSUES_AND_FACTORS.md](FOLLOW_UP_ISSUES_AND_FACTORS.md).

---

## 1. Current Status

- **Symptom addressed:** Bots were not sustaining follow-up dialogue: one or both bots failed the **receive contract** (health check) repeatedly with `WRONG_TRACK` or `NO_INBOUND_RTP`, so the receive gate never passed or flapped, and the pipeline did not treat the bot as “hearing” the other participant.
- **Root cause (from logs and diag):** Inbound RTP was present and the mixer was sometimes outputting audio (`post_mixer_max_abs` non-zero), but the **pre-mixer** sample sent on each truth probe was often 0 or very low. The receive contract previously required **both** `pre_mixer_max_abs > PRE_MIXER_PASS_THRESHOLD` (default 200) **and** `post_mixer_max_abs > 0`. Because pre-mixer sampling can be intermittently silent (Chromium decode timing, multi-participant track selection, or phased negotiation), the contract failed even when the bot was actually receiving and mixing remote audio.
- **Fix applied:** The receive contract was relaxed so that when there is inbound RTP (`audio_inbound_bytes_delta > 0`), we **pass if the mixer output has audio** (`post_mixer_max_abs > 0`). We no longer require the pre-mixer sample to be above threshold for a pass. Failures are still reported when post-mixer is silent (with reason `MIXER_WIRING` or `WRONG_TRACK` as appropriate).

---

## 2. Why This Solution Was Chosen

- **Evidence from runs:** Diag files (e.g. `logs/diag/<conferenceId>_<sessionId>_stats.jsonl`) showed `pre_mixer_max_abs` often 0 or 1 while `post_mixer_max_abs` was sometimes high (e.g. 4165, 12574, 19445), and `premixer_bindings` showed `boundVia: "receiver"` with the correct track. So the receive path (receiver → mixer → Node) was working at least part of the time; the **probe’s pre-mixer snapshot** was not a reliable signal on every 2s sample.
- **Design choice:** The contract’s goal is to answer: “Is this bot receiving remote audio and feeding it to the pipeline?” The **mixer output** (post_mixer) is the actual signal sent to Node for VAD/ASR. Requiring post_mixer > 0 when we have inbound RTP is sufficient to declare the receive path healthy; requiring pre_mixer above a threshold was causing false failures when binding was correct but the pre-mixer sample was taken at a quiet or unsampled moment.
- **What we did not change:** We did not remove the contract or the recv gate. We still fail when post_mixer is 0 (so real mixer-wiring or wrong-track cases are still detected). We did not change the bot-page rebind logic or track selection; those remain in place for cases where the dominant speaker or track id changes.

---

## 3. How It Was Implemented

- **File:** `src/room/jitsi-browser-bot.ts`
- **Logic:** In `handleTruthProbe`, when `inboundBytesDelta > 0`:
  - **Before:** Pass only if `pre_mixer_max_abs > PRE_MIXER_PASS_THRESHOLD` **and** `post_mixer_max_abs > 0`. Otherwise fail with `WRONG_TRACK` (pre-mixer silent) or `MIXER_WIRING` (post-mixer silent).
  - **After:** Pass if `post_mixer_max_abs > 0` (inbound RTP is already implied by the branch). Do not require pre_mixer above threshold. Still fail when post_mixer is 0, and set failure reason to `MIXER_WIRING` if pre_mixer was above threshold, else `WRONG_TRACK`.
- **Log messages:** Pass logs now say “inbound RTP and non-silent mixer; pre_mixer may be flaky” to reflect that we may pass even when the pre-mixer sample was low.
- **Env:** `PRE_MIXER_PASS_THRESHOLD` is still used only for BOT_DIAG verdict and for failure-reason classification; it no longer gates the receive-contract **pass** when post_mixer has audio.

---

## 4. If Follow-Up Dialogue Still Fails

Use this as a runbook to share or to run by others.

### 4.1 Check logs

- **`health_contract_receive`**  
  - `pass: true` and `RECV_GATE_PASSED` → receive path is considered healthy; look elsewhere (ASR, LLM, TTS, or PersonaPlex).
  - `pass: false` with `reason: "WRONG_TRACK"` → inbound RTP but pre- and post-mixer silent; see “Room audio in” below.
  - `pass: false` with `reason: "MIXER_WIRING"` → pre-mixer has level but post-mixer silent; mixer wiring or pull issue in bot page.
  - `reason: "NO_INBOUND_RTP"` (after several probes) → no inbound RTP; check Jitsi/network and that the other participant is unmuted and sending.

- **`BOT_RX_AUDIO_STARTED`** → Node received at least one non-silent room-audio frame from the bot page.

- **`USER_TRANSCRIPT`** → ASR produced text from room audio; if this appears, receive path and ASR are working for that turn.

- **`PERSONAPLEX_FALLBACK_TO_LLM`** / **`PERSONAPLEX_FAILED`** → PersonaPlex timeout or error; follow-up may still occur via fallback or may need PersonaPlex/LLM config.

### 4.2 Run BOT_DIAG for receive-path evidence

```bash
LOG_LEVEL=info USE_JITSI_BOT=true BOT_DIAG=1 npm start
```

- Inspect the printed verdict and `./logs/diag/*_stats.jsonl`.
- **NO_INBOUND_RTP:** Other participant not sending or Jitsi/network issue.
- **INBOUND_RTP_BUT_PREMIX_SILENT:** RTP present but pre-mixer silent over the diag window; with the new contract we may still pass at runtime if post_mixer is non-zero on some probes. If post_mixer is always 0 in the stats, see [AUDIO_DEBUGGING.md](AUDIO_DEBUGGING.md) and [AUDIO_RECEIVE_STATUS_AND_RESEARCH.md](AUDIO_RECEIVE_STATUS_AND_RESEARCH.md).
- **PREMIX_OK_BUT_MIXER_SILENT:** Pre-mixer has level but mixer output silent; wiring/pull in bot page.
- **OK:** Receive path met the BOT_DIAG criteria (including pre_mixer above threshold over the window).

### 4.3 Optional env for stricter or noisier environments

- **`PRE_MIXER_PASS_THRESHOLD`** (default 200): Only affects BOT_DIAG verdict and the **failure reason** (WRONG_TRACK vs MIXER_WIRING). It no longer blocks the receive-contract pass when post_mixer > 0.
- **`RECV_GATE_CONSECUTIVE_N`** (default 3): Number of consecutive receive-contract passes required before `RECV_GATE_PASSED`. Increase if you want more stability before declaring “ready to receive”.

### 4.4 References

- [AUDIO_DEBUGGING.md](AUDIO_DEBUGGING.md) — Boundaries (B0–B4), bot-page stats, BOT_DIAG, “Bot doesn’t respond when I speak”.
- [AUDIO_RECEIVE_STATUS_AND_RESEARCH.md](AUDIO_RECEIVE_STATUS_AND_RESEARCH.md) — Room audio-in design, receiver track binding, and Chromium decode behavior.
- [SMOKE_TEST_RUNBOOK.md](SMOKE_TEST_RUNBOOK.md) — End-to-end and multi-bot test flow.

---

## 5. Short Summary for Sharing

- **Problem:** Follow-up dialogue stopped because the receive health check required a strong pre-mixer level every probe; pre-mixer was often 0 due to timing/decoder, even when the bot was actually receiving and mixing audio.
- **Fix:** Receive contract now passes when there is inbound RTP and the **mixer output** has audio (post_mixer > 0), and no longer requires pre_mixer above threshold for a pass.
- **Where:** `src/room/jitsi-browser-bot.ts`, `handleTruthProbe` (receive contract branch).
- **If it still fails:** Check `health_contract_receive` and `RECV_GATE_PASSED` in logs; run `BOT_DIAG=1` and inspect verdict and `logs/diag/*_stats.jsonl`; use the docs above for room audio in and mixer wiring.
