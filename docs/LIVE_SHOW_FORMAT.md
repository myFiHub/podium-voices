# Live show format: Podium Voices – 10-minute rounds

Recommended repeatable format for live sessions. Fits current memory and running summary so clips are natural and coherent.

## Structure per round

| Phase | Duration | Description |
|-------|----------|-------------|
| **Opener** | ~2 min | Bot speaks opener (or scripted greeting). Ask for stance or topic from the room. Use `TOPIC_SEED` and `OPENER_ENABLED=true` with empty `GREETING_TEXT` for LLM-generated opener. |
| **Debate / interview loop** | ~6 min | Back-and-forth: user speaks, bot responds; audience can react (cheer/boo/like/dislike). Feedback drives tone and length. Multi-agent: coordinator manages turn-taking; no overlap. |
| **Audience-driven conclusion** | ~2 min | Wind down: bot summarizes or asks a closing question; reactions can steer the final tone. |

**Total:** ~10 minutes per round.

## Cadence

- **3 rounds per hour** with short breaks (or back-to-back if operators prefer).
- Running summary (every N turns) keeps context across the round and makes clip extraction coherent.
- Presets: use [PRESETS.md](PRESETS.md) (debate / interview / hype) for env blocks that match the desired energy.

## Clips

- Natural clip boundaries: after opener, after a clear Q&A exchange, or after audience-driven conclusion.
- Tag clips for: **cheer pivot**, **boo reset**, **clean handoff** (multi-agent) for post-session review.
