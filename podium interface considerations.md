Authentication & identity
Token: JWT from Podium login. Used for both REST API (Authorization: Bearer <token>) and WebSocket (?token=<token>&timezone=...).
User: User from /users/profile (or login response). Required fields for hosting:
uuid, address, name, image (optional)
Used for WS identity, Jitsi display name, and access checks (creator/cohost).
Outpost context
OutpostModel (from podiumApi.getOutpost(uuid)):
uuid – outpost id (used for API, WS, and Jitsi room name).
creator_user_uuid, creator_user_name, creator_user_image.
cohost_user_uuids?: string[] – cohosts get same enter/speak as creator.
outpost_host_url? – Jitsi domain (e.g. meet.avaxcoolyeti.com); fallback: NEXT_PUBLIC_OUTPOST_SERVER.
scheduled_for – session start time (join allowed after this for non-creator).
is_archived, has_adult_content, enter_type, speak_type, name, subject, tags, etc.
Access (for hosts)
Creator (myUser.uuid === outpost.creator_user_uuid): canEnter: true, canSpeak: true.
Cohost (outpost.cohost_user_uuids?.includes(myUser.uuid)): same.
Access is computed in getOutpostAccesses() in containers/global/effects/joinOutpost.ts; creator/cohost bypass Luma/tickets/invites.
Live session data
OutpostLiveData: { members: LiveMember[] } from podiumApi.getLatestLiveData(outpostId).
LiveMember: address, uuid, name, image, can_speak, is_present, is_speaking, remaining_time, feedbacks, reactions, is_recording, etc.
Only present members are used: members.filter(m => m.is_present).
2. Connections required
A. REST API (Podium)
Base URL: NEXT_PUBLIC_PODIUM_API_URL (e.g. https://your-podium-api.com/api/v1).
Auth: Authorization: Bearer <token>.
Relevant endpoints (from services/api/index.ts):
POST /auth/login – get token and user.
GET /users/profile – current user.
GET /outposts/detail?uuid=<outpostUuid> – outpost.
POST /outposts/add-me-as-member – { uuid: outpostId, inviter_uuid?: inviterId }.
GET /outposts/online-data?uuid=<outpostId> – live members (requires being in session for 422 “outpost is not live” / “user is not in the session”).
POST /outposts/creator-joined – { uuid: outpostId } (creator only).
POST /outposts/leave – { uuid: outpostId }.
B. WebSocket
URL: NEXT_PUBLIC_WEBSOCKET_ADDRESS (e.g. wss://your-ws.com/ws).
Connect: wss://...?token=<token>&timezone=<IANA_tz>.
Send (JSON): { message_type, outpost_uuid, data? }.
Outgoing types (services/wsClient/types.ts):
JOIN / LEAVE – membership.
START_SPEAKING / STOP_SPEAKING – mic state.
LIKE, DISLIKE, BOO, CHEER – data: { react_to_user_address }.
START_RECORDING / STOP_RECORDING – creator only.
WAIT_FOR_CREATOR, ECHO (health).
Incoming: e.g. user.joined, user.left, user.started_speaking, user.stopped_speaking, remaining_time.updated, user.time_is_up, creator.joined, user.started_recording, user.stopped_recording, reactions, notifications. Message shape: { name: IncomingMessageType, data: IncomingMessageData }.
Join flow: send JOIN with outpost_uuid; server confirms with user.joined where data.address === myUser.address; app then treats “joined” and can call getLatestLiveData.
C. Jitsi (audio/video)
Domain: outpost.outpost_host_url or NEXT_PUBLIC_OUTPOST_SERVER (hostname only, no http(s)://).
Room: roomName = outpost.uuid.
User:
displayName: myUser.name (or truncated), fallback myUser.uuid.
email: transformIdToEmailLike(myUser.uuid) → {uuid-no-dashes}@gmail.com.
Host roles: creatorUuid, cohostUuids passed into the Jitsi meeting so creator/cohosts get moderator rights.
So an agent acting as a host needs: API client (with token), WebSocket client (same token), and Jitsi client (domain, room name, user identity, creator/cohost uuids).
3. Host join flow (for implementation)
Login → get token and User.
Connect WebSocket: wsClient.connect(token, NEXT_PUBLIC_WEBSOCKET_ADDRESS).
Load outpost: podiumApi.getOutpost(outpostUuid).
Resolve access: if myUser.uuid === outpost.creator_user_uuid or outpost.cohost_user_uuids?.includes(myUser.uuid) → canEnter and canSpeak.
Add as member (if not already): podiumApi.addMeAsMember(outpost.uuid).
Join over WS: wsClient.asyncJoin(outpost.uuid) (or asyncJoinOutpostWithRetry) and wait for user.joined for this user.
Optional – creator joined: if creator, podiumApi.setCreatorJoinedToTrue(outpost.uuid).
Join Jitsi: domain from outpost, roomName = outpost.uuid, userInfo from User, creatorUuid / cohostUuids from outpost.
References: containers/global/effects/joinOutpost.ts (access + openOutpost), containers/ongoingOutpost/components/meet.tsx (Jitsi config), services/wsClient/client.ts (connect, join, message types).
4. Context needed for testing
Environment variables
From env.production.template and usage in code:
NEXT_PUBLIC_PODIUM_API_URL – API base.
NEXT_PUBLIC_WEBSOCKET_ADDRESS – WebSocket URL.
NEXT_PUBLIC_OUTPOST_SERVER – Jitsi hostname when outpost_host_url is not set.
(Optional) NEXT_PUBLIC_WEBSITE_LINK_URL – cookie domain for token (e.g. login flow).
Test user
A real or test Podium user that is creator or cohost of at least one outpost (so no Luma/ticket/invite checks).
You need: login credentials (or a way to get a token) and that user’s uuid / address.
Test outpost
uuid: target outpost id.
scheduled_for: in the past (or you use creator/cohost who can join regardless).
Not archived: is_archived === false.
outpost_host_url or reliance on NEXT_PUBLIC_OUTPOST_SERVER for Jitsi.
Token for automated tests
Option A: Run real login (e.g. POST /auth/login with LoginRequest) and use returned token + user.
Option B: Use a long-lived or test token from your backend if available; same token must work for API and WebSocket.
Minimal test sequence
Login → token + user.
getOutpost(testOutpostUuid) → outpost.
Assert creator or cohost so canEnter and canSpeak.
Connect WebSocket with token.
addMeAsMember(outpost.uuid) if needed.
asyncJoin(outpost.uuid) and wait for join confirmation (or timeout).
getLatestLiveData(outpost.uuid) – should return { members: [...] } after join.
(Optional) Join Jitsi with same outpost and user to test full host experience.
Useful code references for test wiring
Join flow: containers/global/effects/joinOutpost.ts (joinOutpost → openOutpost).
WS: services/wsClient/client.ts (connect, asyncJoin/asyncJoinOutpost, message format), services/wsClient/types.ts (all message types).
API: services/api/index.ts (getOutpost, addMeAsMember, getLatestLiveData, setCreatorJoinedToTrue, leaveOutpost).
Types: services/api/types.ts (OutpostModel, LiveMember, OutpostLiveData, User).


Checking how login and outpost creation work so we can show how to obtain or generate the required data.


[8 tools called]


Checking how `aptos_address` and `username` are derived in the login flow:


[4 tools called]


Here’s how you can **generate or obtain** each piece of information your A.I. agent needs.

---

## 1. **Token and user (authentication)**

The app uses **wallet-based login**: the backend expects a signed message and returns a JWT and user.

### Option A: Use the real app (easiest)

1. Log in in the browser (social or wallet).
2. Read the token from the cookie (same as `test-auth-fix.js`):
   ```javascript
   document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1]
   ```
3. Get the current user via API with that token:
   ```http
   GET /users/profile
   Authorization: Bearer <token>
   ```
4. Use this token (and user) in your agent or in Postman/scripts.

### Option B: Generate a login programmatically (headless agent)

You need a **private key** that the backend already knows (e.g. from a previous Web3Auth signup with the same identity).

From the code:

- **Username** in `LoginRequest` = EVM address from that key: `new ethers.Wallet(privateKey).address`.
- **Aptos address** = Movement/Aptos address from the same key via `movementService`:  
  `Ed25519PrivateKey` + `Account.fromPrivateKey` → `account.address.toString()`  
  (see `services/move/aptosMovement.ts` and `containers/global/effects/login/after_connect.ts`).
- **Signature** = sign the string **`${username}-${timestampInUTCInSeconds}`** (same as `lib/signWithPrivateKey.ts`):
  - `timestampInUTCInSeconds = Math.floor(Date.now() / 1000)`
  - Message = `"<evmAddress>-<timestampInUTCInSeconds>"`
  - Sign with `ethers.Wallet(privateKey).signMessage(message)`.

Then call:

```http
POST /auth/login
Content-Type: application/json

{
  "signature": "<signature>",
  "timestamp": <timestampInUTCInSeconds>,
  "username": "<evmAddress>",
  "aptos_address": "<movement/aptosAddress>",
  "has_ticket": false,
  "login_type": "<e.g. google>",
  "login_type_identifier": "<id from Web3Auth>"
}
```

Response gives you **token** and **user**. The backend must already have this identity (normally from a first-time login via the app).

### Option C: Backend support for agents

If your backend adds an **agent/bot auth** (e.g. API key or “server login” endpoint), you would use that to **generate** a token without a wallet. The current repo only shows wallet-based login.

---

## 2. **Outpost (context for the agent)**

### Create a new outpost (you need a token)

Use the same types as in `CreateOutpostRequest` (`services/api/types.ts`):

```ts
// CreateOutpostRequest
{
  name: string;
  subject: string;
  scheduled_for: number;        // Unix timestamp (ms or s – check API)
  image: string;               // URL
  enter_type: string;          // e.g. "everyone", "having_link", "invited_users"
  speak_type: string;
  has_adult_content: boolean;
  tickets_to_enter: string[];
  tickets_to_speak: string[];
  cohost_user_uuids?: string[]; // Optional – add agent user UUID to make it cohost
  is_recordable: boolean;
  tags: string[];
  reminder_offset_minutes?: number;
  enabled_luma?: boolean;
  luma_guests?: AddGuestModel[];
  luma_hosts?: AddHostModel[];
}
```

Call:

```http
POST /outposts/create
Authorization: Bearer <token>
Content-Type: application/json
<body: CreateOutpostRequest>
```

Response is the **OutpostModel** (includes `uuid`, `creator_user_uuid`, `cohost_user_uuids`, `outpost_host_url`, etc.). That outpost is yours, so the agent user is creator and has full host rights.

### Use an existing outpost

- **My outposts:**  
  `GET /outposts/my-outposts` (with token) → list of outposts where the user is creator.
- **One outpost:**  
  `GET /outposts/detail?uuid=<outpostUuid>` (with token) → single **OutpostModel**.

Use the returned `uuid` and other fields as the “information” your agent needs.

---

## 3. **Access (canEnter / canSpeak)**

You don’t call an endpoint to “generate” this. You **compute** it in code (same as `getOutpostAccesses` in `containers/global/effects/joinOutpost.ts`):

- If **myUser.uuid === outpost.creator_user_uuid** → `canEnter: true`, `canSpeak: true`.
- Else if **outpost.cohost_user_uuids** includes **myUser.uuid** → same.
- Otherwise access depends on Luma, tickets, invites, etc.

So you “generate” the fact “this agent can host” by either:

- Using an outpost **created** by that user (creator), or  
- Using an outpost where that user is in **cohost_user_uuids** (set when creating or updating the outpost).

---

## 4. **Live data (OutpostLiveData / LiveMember)**

Only available **after** the user has joined the outpost over WebSocket (and backend has them in the session):

```http
GET /outposts/online-data?uuid=<outpostId>
Authorization: Bearer <token>
```

- **Before join or when outpost isn’t live:** you can get 422 (“outpost is not live” / “user is not in the session”).
- **After a successful WS join** for that user, this returns `{ members: LiveMember[] }`.

So you “generate” live data by:

1. Having a token and user.
2. Connecting to the WebSocket with that token.
3. Sending a join for that outpost and waiting for the server to confirm (e.g. `user.joined` with your address).
4. Then calling `GET /outposts/online-data?uuid=<outpostId>`.

---

## 5. **Practical ways to “generate” everything for testing**

| What you need | How to generate it |
|---------------|---------------------|
| **Token + User** | (A) Log in in the app, read token from cookie, call `GET /users/profile`. (B) Use a known private key and build `LoginRequest` (signature + timestamp + username + aptos_address + has_ticket + login_type + login_type_identifier), then `POST /auth/login`. |
| **Outpost** | Create one with `POST /outposts/create` (with token) and use the returned OutpostModel, or use `GET /outposts/my-outposts` or `GET /outposts/detail?uuid=...` to get an existing one. |
| **Access** | Use an outpost where the agent user is creator or in `cohost_user_uuids` so you can treat `canEnter` and `canSpeak` as true. |
| **Live members** | After WS connect + join outpost, call `GET /outposts/online-data?uuid=<outpostId>`. |

### Minimal script-style flow (for one run)

1. Get **token** (and optionally **user**) via Option A or B above.
2. Set **base URL** from `NEXT_PUBLIC_PODIUM_API_URL` and **WebSocket URL** from `NEXT_PUBLIC_WEBSOCKET_ADDRESS`.
3. **Create outpost** with `POST /outposts/create` (or pick one with `GET /outposts/detail?uuid=...`).
4. **Connect WebSocket** with `?token=<token>&timezone=<IANA>`.
5. **Join outpost**: send `{ message_type: "join", outpost_uuid: "<uuid>" }`, wait for `user.joined` for your address.
6. **Fetch live data**: `GET /outposts/online-data?uuid=<outpostId>`.

That gives you all the “information needed” in a form your agent can use. If you tell me whether you prefer “browser login + copy token” or “headless script with private key”, I can outline the exact steps (and, if you switch to Agent mode, the exact code) for that path.