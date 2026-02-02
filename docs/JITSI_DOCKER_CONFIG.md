# Jitsi Docker – verifying server config for the bot

When the meet is served by the **official [jitsi/docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet)** stack, use these steps on the server to read the values the bot must use. Then set the corresponding env in `.env.local` (see [README Config / Jitsi Docker](../README.md#jitsi-docker-server-configuration-reference)).

## 1. List containers

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

Note the **web** container name (e.g. `jitsi-docker-web-1`) and **Prosody** (e.g. `jitsi-docker-prosody-1`).

## 2. Meet config (hosts, bosh, websocket)

Replace `<WEB_CONTAINER_NAME>` with the web container name from step 1.

**Full config:**
```bash
docker exec <WEB_CONTAINER_NAME> cat /config/config.js
```

**Connection-related only:**
```bash
docker exec <WEB_CONTAINER_NAME> grep -E "hosts|bosh|serviceUrl|websocket" /config/config.js
```

From the output:

- **`config.hosts.domain`** → set **`JITSI_XMPP_DOMAIN`** (e.g. `meet.jitsi`).
- **`config.hosts.muc`** → set **`JITSI_MUC_DOMAIN`** (e.g. `muc.meet.jitsi`).
- **`config.bosh`** → public hostname is in the URL (e.g. `https://outposts.myfihub.com/http-bind`); ensure the API returns that host as `outpost_host_url` or set **`NEXT_PUBLIC_OUTPOST_SERVER`**.
- **`config.websocket`** → optional; bot uses BOSH by default.

## 3. Container env (XMPP domain, MUC)

```bash
docker exec <WEB_CONTAINER_NAME> env | grep -iE "XMPP|BOSH|PUBLIC_URL|DOMAIN|MUC"
```

Typical output:

- **`XMPP_DOMAIN`** → same as `config.hosts.domain`; use for **`JITSI_XMPP_DOMAIN`**.
- **`XMPP_MUC_DOMAIN`** → same as `config.hosts.muc`; use for **`JITSI_MUC_DOMAIN`**.
- **`PUBLIC_URL`** → public base URL; hostname must match what the bot uses for BOSH (from API or **`NEXT_PUBLIC_OUTPOST_SERVER`**).

## 4. Prosody (optional)

To confirm VirtualHost and MUC component hostnames:

```bash
docker exec <PROSODY_CONTAINER_NAME> grep -E "VirtualHost|Component|muc" /config/prosody.cfg.lua
```

These should match **`JITSI_XMPP_DOMAIN`** and **`JITSI_MUC_DOMAIN`**.

## Example (outposts.myfihub.com)

From a typical Jitsi Docker deployment:

| Server config / env       | Bot env / behavior |
|---------------------------|---------------------|
| `config.hosts.domain = 'meet.jitsi'` | `JITSI_XMPP_DOMAIN=meet.jitsi` |
| `config.hosts.muc = 'muc.meet.jitsi'` | `JITSI_MUC_DOMAIN=muc.meet.jitsi` |
| `config.bosh = 'https://outposts.myfihub.com/http-bind'` | API returns `outpost_host_url` or `NEXT_PUBLIC_OUTPOST_SERVER=outposts.myfihub.com` |
| `XMPP_MUC_DOMAIN=muc.meet.jitsi` | Same as `JITSI_MUC_DOMAIN` |

**.env.local (excerpt):**

```env
NEXT_PUBLIC_OUTPOST_SERVER=outposts.myfihub.com
JITSI_XMPP_DOMAIN=meet.jitsi
JITSI_MUC_DOMAIN=muc.meet.jitsi
USE_JITSI_BOT=true
```
