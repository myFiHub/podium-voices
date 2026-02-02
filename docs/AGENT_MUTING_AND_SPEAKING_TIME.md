# Muting, Unmuting, and Speaking Time (Nexus / Podium)

This document describes what the AI agent needs to know for **muting/unmuting** and **speaking time** so it stays in sync with the Podium/Nexus frontend. Use it when implementing or extending the agent’s behavior.

---

## 1. Muting and unmuting

### WebSocket (Podium layer)

**Outgoing (agent says “I’m speaking” / “I stopped speaking”):**

- **Unmute / start speaking:** send  
  `{ message_type: "start_speaking", outpost_uuid: "<outpostUuid>" }`
- **Mute / stop speaking:** send  
  `{ message_type: "stop_speaking", outpost_uuid: "<outpostUuid>" }`

**Incoming (others’ mute state):**

- `user.started_speaking` → `data.address` = wallet address of user who unmuted
- `user.stopped_speaking` → `data.address` = wallet address of user who muted  

The agent should **map `data.address` to a participant** (e.g. via `LiveMember.address` from `getLatestLiveData`).

### Jitsi (actual audio)

- **Mute/unmute in the room** is done via the Jitsi API (e.g. `apiObj.executeCommand("toggleAudio")` in Nexus).
- The agent needs the **Jitsi meeting API** (or equivalent in its stack) to:
  - Mute/unmute the bot’s mic.
  - Optionally listen to **audioMuteStatusChanged** (or similar) so it knows when the bot’s mute state changed and can send **start_speaking** / **stop_speaking** over WebSocket to stay in sync with Podium.

### Rules in Nexus the agent should mirror

- **When unmuting:**  
  Only send **start_speaking** if WS is healthy and (for non‑creator) **remaining_time > 0**; otherwise mute again.
- **When muting:**  
  Send **stop_speaking** so Podium and other clients see “not speaking.”

**So for muting/unmuting the agent needs:**

- **Outpost UUID** (for `outpost_uuid` in WS messages).
- **WebSocket client** that can send `start_speaking` / `stop_speaking`.
- **Jitsi (or bot) API** to mute/unmute the bot’s mic and (optionally) get mute status.
- **Own remaining time** (see below) so it doesn’t start speaking when time is up.

---

## 2. Speaking time

### Data model

- **`LiveMember`** (from **GET /outposts/online-data** and from WS updates) has:
  - **`remaining_time`** – seconds left for that member to speak (integer).
  - **`is_speaking`** – whether they are currently speaking.
  - **`address`** – wallet address (used in WS `data.address`).
  - **`uuid`** – Podium user UUID.
- **Creator** is special: Nexus treats creator as having no time limit (e.g. “Creator” label, no countdown). The agent should treat **creator** (e.g. `member.uuid === outpost.creator_user_uuid`) as **unlimited** remaining time for UI/logic.

### Where the agent gets speaking time

1. **GET /outposts/online-data?uuid=&lt;outpostUuid&gt;**  
   Returns **`members`**; each has **`remaining_time`**, **`is_speaking`**, **`address`**, **`uuid`**.  
   The agent needs to **identify itself** (e.g. by `User.address` or `User.uuid`) and read **its own** `remaining_time` and `is_speaking`.

2. **WebSocket:**
   - **`remaining_time.updated`** → `data.address`, **`data.remaining_time`**.  
     Use this to update that member’s remaining time (by `address`).
   - **`user.time_is_up`** → `data.address`.  
     That user’s time ran out; set `is_speaking = false` for that user (and if it’s the agent, mute and stop sending **start_speaking** until time is refilled, if ever).

3. **Local countdown (Nexus behavior):**  
   Nexus also decrements **remaining_time** every second for **non‑creator** members who are **is_speaking**. The server may do the same; the agent can either rely on **remaining_time.updated** / **user.time_is_up** or implement a local countdown from the last known **remaining_time** for consistency.

### What the agent must know for “understanding” speaking time

- **Outpost UUID** and **current user (bot) identity:**  
  `User.address` and/or `User.uuid` so it can find itself in **live members** and in WS `data.address`.
- **Outpost creator:**  
  `outpost.creator_user_uuid` so it can treat creator as unlimited time.
- **Per-member:**  
  For each member (and for itself): **`remaining_time`**, **`is_speaking`**, **`address`** (and optionally **`uuid`**).
- **Events:**  
  - **remaining_time.updated** → update stored **remaining_time** for **data.address**.  
  - **user.time_is_up** → set that user as no longer speaking; if it’s the bot, mute and don’t start speaking again until allowed.
- **Rule:**  
  If the agent is **not** the creator and **remaining_time ≤ 0**, it should **not** unmute / send **start_speaking** (Nexus re-mutes when time is up).

---

## 3. Summary checklist for the agent

| Topic | What the agent needs |
|-------|----------------------|
| **Mute / unmute (Podium)** | Send **start_speaking** when bot unmutes, **stop_speaking** when bot mutes; payload: **message_type** + **outpost_uuid**. |
| **Who is speaking** | Incoming WS: **user.started_speaking** / **user.stopped_speaking** with **data.address**; map to live members. |
| **Bot’s own mute** | Jitsi (or bot) API to mute/unmute mic; optionally sync with **start_speaking** / **stop_speaking**. |
| **Speaking time** | **LiveMember.remaining_time**, **is_speaking**, **address**; **outpost.creator_user_uuid** (creator = unlimited). |
| **Source of truth** | **GET /outposts/online-data** for initial list; **remaining_time.updated** and **user.time_is_up** over WS for updates. |
| **Bot’s identity** | **User.address** (and **User.uuid**) to find self in **liveMembers** and in WS **data.address**. |
| **Rule** | If not creator and **remaining_time ≤ 0**, do not unmute / send **start_speaking**; on **user.time_is_up** for self, mute and stop speaking. |

So for muting/unmuting and speaking time, the agent needs: **outpost UUID**, **own user (address/uuid)**, **creator UUID**, **live members** (with **remaining_time**, **is_speaking**, **address**), **WebSocket** for **start_speaking** / **stop_speaking** and for **remaining_time.updated** / **user.time_is_up**, and **Jitsi (or bot) API** for actual mute/unmute of the bot’s mic.

---

## 4. Implementation status in this repo

| Requirement | Status | Where in codebase |
|-------------|--------|-------------------|
| Send **start_speaking** / **stop_speaking** | **API exists, not wired** | `PodiumWS.startSpeaking(outpostUuid)` / `PodiumWS.stopSpeaking(outpostUuid)` in `src/room/ws.ts`. Not called when TTS starts/stops. |
| Incoming **user.started_speaking** / **user.stopped_speaking** | **Types only** | `WS_INCOMING_NAMES` in `src/room/types.ts`. No handler in `RoomClient` or main. |
| GET **/outposts/online-data** | **API exists, not used for speaking time** | `PodiumApi.getLatestLiveData(outpostId)` in `src/room/api.ts`. Returns `OutpostLiveData` with `members: LiveMember[]`. Not called after join to read remaining_time / is_speaking. |
| **remaining_time.updated** / **user.time_is_up** | **Types only** | `WS_INCOMING_NAMES.REMAINING_TIME_UPDATED`, `USER_TIME_IS_UP` in `src/room/types.ts`. No handler to update agent’s view of remaining_time or to mute on time_is_up. |
| **LiveMember** (remaining_time, is_speaking, address, uuid) | **Defined** | `src/room/types.ts` – `LiveMember`, `OutpostLiveData`. |
| **Outpost UUID, User, creator UUID** | **Available** | `RoomClient` has `config.outpostUuid`, `user`, `outpost.creator_user_uuid` after join. |
| Jitsi bot mute/unmute | **Not implemented** | Bot page injects TTS as synthetic mic; no “mute” command to stop pushing audio. Would require bridge protocol extension and/or Jitsi API in bot page. |

**Suggested next steps:**

1. When the pipeline **starts** sending TTS: call `ws.startSpeaking(outpostUuid)` (and only if WS healthy and, for non-creator, own `remaining_time > 0`).
2. When the pipeline **finishes** a TTS segment: call `ws.stopSpeaking(outpostUuid)`.
3. After join: call `api.getLatestLiveData(outpostUuid)` and maintain a small “live state” (e.g. map `address` → `{ remaining_time, is_speaking }`); treat creator as unlimited.
4. Subscribe to WS: on **remaining_time.updated** update stored `remaining_time` for `data.address`; on **user.time_is_up** set that user as not speaking and, if self, mute and stop sending start_speaking until allowed.
5. Optionally: extend bot bridge and/or Jitsi to mute/unmute the bot’s “mic” and keep it in sync with **start_speaking** / **stop_speaking**.
