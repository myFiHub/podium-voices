# PersonaPlex pool router (Topology B)

PersonaPlex behaves like a **single-capacity worker** (effectively **one active session/turn at a time**). To scale beyond “one instance per bot”, we replicate PersonaPlex instances and route sessions to them with explicit backpressure.

This repo includes a minimal router implementation:

- [`scripts/personaplex-router.js`](../scripts/personaplex-router.js)

## Why a router

- **One stable URL** for bots (`PERSONAPLEX_SERVER_URL=http://router:9000`)\n+- **Sticky assignment** by `X-Session-Key` (e.g. `roomId:agentId`)\n+- **Explicit backpressure** instead of misleading timeouts\n+- Central point to add quotas, priorities, and diagnostics

## Capacity contract

- Each PersonaPlex instance is treated as **max inflight = 1** (configurable).\n+- If all instances are busy, the router rejects the WebSocket upgrade with:\n  - HTTP `429 Too Many Requests`\n  - `Retry-After: 1`

## Running

Example with two local PersonaPlex instances:

```bash
# 1) Start instances (ports 8998/8999)
npm run personaplex:up -- --instances 2 --base-port 8998

# 2) Start router
PERSONAPLEX_POOL="https://localhost:8998,https://localhost:8999" \\
PERSONAPLEX_BACKEND_INSECURE_TLS=1 \\
PERSONAPLEX_ROUTER_PORT=9000 \\
node scripts/personaplex-router.js
```

Point bots at:

```bash
PERSONAPLEX_SERVER_URL=http://localhost:9000
```

## Observability

Router endpoints:

- `GET /health` – overall health + per-instance counters\n+- `GET /instances` – pool + inflight + sticky map size

Client routing key:

- Send `X-Session-Key: <roomId:agentId>` on the WebSocket handshake.\n  - Future improvement: have the Node PersonaPlex client send this header automatically.

## Limitations (MVP)

- Stickiness is **in-memory** only (no HA).\n+- Health is “best-effort” (marks unhealthy on connection errors).\n+- No queueing: saturation yields fast 429.

