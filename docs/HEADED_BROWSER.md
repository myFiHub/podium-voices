# Headed browser (Xvfb) for reliable remote audio

When the bot runs in **headless** Chromium, remote participant audio can arrive as silence at the mixer (`ROOM_MIXER_LEVEL` / `ROOM_AUDIO_RX_LEVEL` stay 0) even though humans hear each other. Running Chromium **headed** (with a virtual or real display) often fixes this by using the same media pipeline as normal Chrome.

## Quick enable

1. Set in `.env.local`:
   ```bash
   BROWSER_HEADED=true
   ```
2. Ensure a display is available:
   - **Local dev (Linux/WSL):** real display or `Xvfb` (see below).
   - **Server/CI:** run under `Xvfb` or another virtual display.

3. Rebuild and start:
   ```bash
   npm run build && npm start
   ```

4. In logs, confirm **`BROWSER_HEADED`** and then check **`ROOM_MIXER_LEVEL`** / **`ROOM_AUDIO_RX_LEVEL`** while someone speaks. If they go non-zero, headed mode has fixed the issue.

## Xvfb (virtual display) on Linux

Headless servers have no display. Use Xvfb so Chromium has a virtual one:

```bash
# Install (Debian/Ubuntu)
sudo apt-get install -y xvfb

# Run the app under Xvfb (single session)
xvfb-run -a -s "-screen 0 1280x720x24" npm start
```

Or start a long-lived Xvfb and set `DISPLAY`:

```bash
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
npm start
```

Docker: use an image that includes Xvfb (e.g. `node` + `xvfb`), or run the above in the container entrypoint.

## Decision tree (Phase 1: prove it)

1. **Run with `BROWSER_HEADED=true` and Xvfb** (or a real display).
2. Have a human speak for 5–10 seconds (unmuted).
3. Check logs:
   - **`ROOM_MIXER_LEVEL`** and **`ROOM_AUDIO_RX_LEVEL`** become **non-zero** → Headed fixes the issue. **Ship headed + Xvfb as the short-term production path.**
   - They **stay 0** → The cause is not “headless decode path.” Focus on track selection, mute state, mixer wiring, or attachment timing (see `AUDIO_DEBUGGING.md`).

## Phase 2: scaling

- **Browser fleet (headed + Xvfb per bot)**  
  One Chromium + Xvfb per bot. Scale by adding containers/VMs; use health checks (e.g. remote audio bytes increasing, mixer non-zero when humans talk), memory limits, and restart policies.

- **Server-side / gateway ingestion (e.g. Jigasi-style)**  
  Avoids “N browsers” by capturing audio on the server. More engineering, better scalability; consider if you need many concurrent bots.

The “flags-only, stay headless” path is usually the least reliable long-term for this class of bug.

## Tradeoffs (summary)

| | Headed + Xvfb | Stay headless |
|--|----------------|----------------|
| **Remote audio in mixer** | Most reliable fix for “headless decode is silent” | May stay silent |
| **Per-bot cost** | Higher (one browser + display per bot) | Lower |
| **Scaling** | Scale by containers; infra-heavy but workable | Lighter, but only if audio actually works |
| **Debugging** | Inspect page, webrtc-internals, audio graph | Harder |

## Security note

Browser automation on servers often uses `--no-sandbox` in containers. Prefer a sandbox-friendly runtime where possible and avoid relaxing security more than necessary.
