# Cadence Personas

This directory holds **cadence persona** specs: bundles of controllable variables for script, prosody markup, and TTS so that each persona’s cadence stays consistent.

## What’s in a persona file

Each `*.json` file defines:

- **Style contract** – Measurable targets: WPM (baseline, stakes, connective), pause budget, pause tiers (comma/period/paragraph/emphasis lead-in), phrase length, emphasis density, intonation.
- **Writing guidelines** – How to write for this cadence: sentence architecture, what to prefer/avoid (for LLM and any cadence rewrite pass).
- **Cadence markup** – Convention for internal marks (e.g. `[p350]`, `*emphasis*`) and how they map to SSML.
- **SSML defaults** – Prosody rate/pitch, emphasis level, and an example fragment.
- **Voice characteristics** – Pitch range, traits, stability, style exaggeration, and optional **`googleVoiceName`** (e.g. `en-US-Neural2-D`, `en-US-Neural2-F`). When set, the pipeline uses this Google Cloud TTS voice for this persona so each PERSONA_ID can have a distinct voice. See `docs/GOOGLE_TTS_VOICES` for the full list.
- **Config** – Key-value pairs for the pipeline (e.g. `ORATOR_RATE`, `PAUSE_COMMA_MS`, `EMPHASIS_PER_WORDS`). These can be wired to env (e.g. `PERSONA_CADENCE_PROFILE=orator_v1`) so the agent’s speaker uses a cadence post-processor and TTS with these settings.

## Personas included

| Id             | Name           | Inspiration (vibe only) |
|----------------|----------------|---------------------------|
| `orator`       | The Orator     | Measured, presidential, inspirational orator. |
| `podcast_host` | The Podcast Host | Conversational, curious, laid-back long-form host. |
| `bold_host`    | The Bold Host  | Confident, punchy, intimate; strong POV. |
| `storyteller`  | The Storyteller| TED/narrative; clear arcs, tension and release. |
| `pundit`       | The Pundit     | Debate/panel; sharp, assertive, quick comebacks. |

## How to use

1. **LLM / rewrite** – Use each persona’s `writingGuidelines` in the system prompt or in a dedicated “write for cadence” rewrite step.
2. **Cadence post-processor** – Between LLM output and TTS, run a step that:
   - Optionally asks the LLM to emit `cadence_marks` (e.g. `[p150]`, `*word*`).
   - Converts markup to SSML using this persona’s `pauseTiers` and `ssmlDefaults`.
3. **TTS** – Use `ssmlDefaults` (rate, pitch, emphasis), `voice.googleVoiceName` (when using Google TTS) for voice identity, and `voice` traits for tuning. Send SSML to the TTS engine when supported.
4. **Config** – Per agent, set env (or config) from `config` in the chosen persona, e.g.:
   - `PERSONA_CADENCE_PROFILE=orator_v1`
   - `ORATOR_RATE=0.92`
   - `PAUSE_COMMA_MS=150`
   - etc.

## Calibration

- **Automated:** From synthesized audio, compute WPM, pause %, average/longest pause, clause length (e.g. from punctuation). Gate: e.g. if WPM > 175 or pause% < 10%, drift toward “podcast fast”; if pause% > 28%, drift toward “overly dramatic.”
- **Human:** Rate the same 20–30s script on composure, clarity, warmth, urgency, naturalness (e.g. 1–5) when you change settings.

## Schema

Types are in `src/prompts/cadence-personas/types.ts`. Load personas in code via `getCadencePersona(id)` from `src/prompts/cadence-personas/index.ts` (reads from this `personas/` directory).
