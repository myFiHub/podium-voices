# Headed browser (optional run mode)

`BROWSER_HEADED=true` runs Chromium with a visible window instead of headless. It requires a display (e.g. real monitor or Xvfb on Linux).

**Note:** Diagnosis and troubleshooting in this repo do not support headed mode as a fix for “bot doesn’t hear human” or silent remote audio. Use headed only if you need a visible browser for debugging (e.g. inspecting the bot page or WebRTC internals).

## Enabling

1. In `.env.local`:
   ```bash
   BROWSER_HEADED=true
   ```
2. Ensure a display is available:
   - **Local (Linux/WSL):** real display or Xvfb (see below).
   - **Server/CI:** run under Xvfb or another virtual display.

3. Rebuild and start:
   ```bash
   npm run build && npm start
   ```

## Xvfb (virtual display) on Linux

If there is no display (e.g. headless server), use Xvfb so Chromium can open a window:

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

Docker: use an image that includes Xvfb, or run the above in the container entrypoint.

## Security note

Browser automation on servers often uses `--no-sandbox` in containers. Prefer a sandbox-friendly runtime where possible and avoid relaxing security more than necessary.
