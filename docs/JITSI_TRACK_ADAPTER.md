# Jitsi Track Adapter (bot-page)

The bot injects a **synthetic microphone** (PCM from Node over the bridge) into the Jitsi conference. Jitsi expects a `JitsiLocalTrack`-like object; we don't have a real one, so `bot-page/bot.js` uses a **wrapper** that implements the minimum surface Jitsi calls in our join path.

## Why a wrapper?

We create the mic as a browser `MediaStreamTrack` (from `createMicTrackFromPcm()`). The conference is joined with a real Jitsi track; we then call `room.replaceTrack(oldTrack, newTrack)`. Jitsi treats `newTrack` as a full local track and may call e.g. `setSourceName`, `getDeviceId`, `mute`, `addEventListener`. The wrapper provides these so we don't get "X is not a function" at runtime.

## Implemented surface (minimum “audio local track adapter”)

| Area | Methods / behavior |
|------|--------------------|
| **Identity** | `getType()` → `"audio"`, `isLocal()` → `true`, `getId()` / `getTrackId()`, `getTrack()` / `getOriginalTrack()`, `getStream()` / `getOriginalStream()` |
| **Mute** | `mute()`, `unmute()`, `isMuted()`, `setMute(muted)` |
| **Events** | `addEventListener`, `removeEventListener`, `on`, `off` (stub emitter; handlers registered but not invoked for adapter-driven changes) |
| **Metadata** | `getDeviceId()`, `getLabel()`, `setSourceName(name)`, `getSourceName()`, `setDeviceId` (no-op), `isAudioTrack()` / `isVideoTrack()` |
| **Lifecycle** | `dispose()`, `stop()` (stops underlying track) |
| **Attach** | `attach(el)`, `detach(el)` (set/clear `el.srcObject`) |
| **Optional stubs** | `getConstraints`, `getSettings`, `applyConstraints`, `setEffect`, `getEffect`, `getAudioLevel` |

## Discovering missing surface (dev)

To avoid guessing with new Jitsi versions, you can log **missing** property/method access on the wrapper:

- Open the bot page with **`?botStrictTrack=1`** in the URL (e.g. `https://your-host/bot?botStrictTrack=1`).
- The wrapper is then wrapped in a **Proxy** that logs `[Bot Jitsi track adapter] missing access: <prop>` for any access not implemented on the adapter.
- Use this in a dev session to see what else Jitsi calls and add it to the adapter (or consider moving to a real Jitsi track — see below).

**Important:** The adapter is **not** Proxy-wrapped in production mode. A “return no-op for unknown property” Proxy can accidentally change truthiness checks inside lib-jitsi-meet (e.g. `track.disposed`) and cause hard-to-debug runtime errors (like “Track has been already disposed”). The Proxy is strictly a dev-only “log missing surface” tool.

## Mute semantics (what we actually do)

The adapter’s `mute()` / `unmute()` / `setMute()` also toggles the underlying `MediaStreamTrack.enabled`. This ensures the synthetic mic is truly gated at the WebRTC layer (not just a local boolean).

## Longer-term: real Jitsi track (Strategy A)

The most stable approach is to **not** wrap: create a real Jitsi track (e.g. via `JitsiMeetJS.createLocalTracks` or by letting lib-jitsi-meet create the track from a `MediaStreamTrack`) and use `conference.replaceTrack(oldJitsiTrack, newJitsiTrack)` with both real Jitsi objects. That avoids chasing new method requirements on Jitsi upgrades. The current wrapper is a pragmatic MVP solution until that refactor is done.
