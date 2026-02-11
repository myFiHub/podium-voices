# Responsiveness and latency

This doc describes how bot responsiveness is measured and how to tune it. The main user-facing metric is **end-of-user-speech to first bot audio**.

---

## Latency chain (standard pipeline)

Time from when the user stops speaking to when the bot’s first audio is sent is determined by:

1. **VAD** – Silence duration (ms) after speech before “end of turn” is declared. Config: `VAD_SILENCE_MS` (default 500).
2. **ASR** – Transcription of the user segment (batch or streaming session end). Streaming ASR is used when the adapter supports it.
3. **Coordinator** (if used) – Collection window so multiple agents can register before a turn decision. Config: `COORDINATOR_COLLECTION_MS` (default 300).
4. **LLM** – Generation of the reply (streaming; may be pipelined with TTS per sentence for lower latency).
5. **TTS** – First audio chunk is sent as soon as the first sentence (or full reply) is synthesized.

---

## Turn metrics in logs

Each turn logs `TURN_METRICS` with:

- `asr_latency_ms` – ASR duration.
- `llm_latency_ms` – LLM duration (or time to first audio when using sentence-by-sentence TTS).
- `tts_latency_ms` – TTS duration for the turn.
- **`end_of_user_speech_to_bot_audio_ms`** – End of user speech to first bot audio (primary KPI for responsiveness).

Use these fields to compare before/after tuning (e.g. after lowering VAD/coordinator or enabling sentence-based TTS).

---

## Tunables

| Variable | Default | Effect |
|----------|---------|--------|
| **VAD_SILENCE_MS** | 500 | Silence (ms) after speech before end-of-turn. Lower (e.g. 300) = faster response; may cut off slow speakers. Recommend 300–500. |
| **COORDINATOR_COLLECTION_MS** | 300 | Coordinator collection window (ms) before turn decision. Lower (e.g. 100–150) for single-agent or low-latency; multi-agent may need 300 so all agents can register. |
| **Sentence-based TTS** | enabled (standard pipeline) | LLM stream is flushed at sentence boundaries (`.` `!` `?` or newline) and each sentence is sent to TTS immediately so first audio can start before the full reply is generated. Chunks are capped at 250 characters when no boundary is found. |

Agent-side coordinator client already supports `pollIntervalMs` and `decisionTimeoutMs`; lower `pollIntervalMs` (e.g. 30) can reduce perceived delay once the server has decided (configurable where the coordinator client is built, e.g. via env if exposed).

---

## Sentence-based TTS (standard pipeline)

In the standard pipeline, the orchestrator consumes the LLM token stream and flushes at sentence boundaries (`.` `!` `?` or newline). Each complete sentence is sent to TTS and its audio is streamed to the bridge immediately, so the user hears the first sentence while the LLM is still generating the rest. Barge-in (user speech during bot reply) still cancels TTS. Full reply is still sanitized and stored in memory and sent to the coordinator once the stream is done.

## Recommendations

- Use `end_of_user_speech_to_bot_audio_ms` in logs to measure impact of changes.
- For faster response: try `VAD_SILENCE_MS=300` and, when using the coordinator, `COORDINATOR_COLLECTION_MS=100` or `150` for single-agent setups.
- PersonaPlex backend streams audio from the server and has its own latency profile; this doc applies to the standard ASR → LLM → TTS pipeline.
- To verify responsiveness: run a turn (e.g. via E2E or manual test), then check logs for `TURN_METRICS` and compare `end_of_user_speech_to_bot_audio_ms` before/after tuning or after enabling sentence-based TTS.
