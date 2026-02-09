#!/usr/bin/env node
/**
 * PersonaPlex pool router (Topology B MVP).
 *
 * PersonaPlex instances are single-capacity workers (max 1 in-flight session/turn each).
 * This router provides:
 * - One stable URL for clients (bots)
 * - Pool selection + stickiness by session key
 * - Explicit backpressure (HTTP 429 on WS upgrade when pool saturated)
 * - Introspection endpoints (/health, /instances)
 *
 * IMPORTANT: PersonaPlex uses a WebSocket streaming API at `/api/chat`.
 * This router proxies WS frames bi-directionally.
 *
 * Env:
 *   PERSONAPLEX_ROUTER_PORT=9000
 *   PERSONAPLEX_POOL="https://localhost:8998,https://localhost:8999"
 *   PERSONAPLEX_MAX_INFLIGHT_PER_INSTANCE=1
 *   PERSONAPLEX_BACKEND_INSECURE_TLS=1          (dev only; allows self-signed backend certs)
 *   PERSONAPLEX_STICKY_TTL_MS=1800000           (default 30 min)
 *
 * Client must provide a stable routing key:
 * - Header: X-Session-Key: <roomId:agentId>
 *
 * Usage:
 *   node scripts/personaplex-router.js
 */

const http = require("http");
const { URL } = require("url");
const WebSocket = require("ws");

function envStr(name, fallback = "") {
  const v = (process.env[name] || "").trim();
  return v ? v : fallback;
}
function envInt(name, fallback) {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
function envBool(name, fallback = false) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on";
}

const port = envInt("PERSONAPLEX_ROUTER_PORT", 9000);
const poolSpec = envStr("PERSONAPLEX_POOL", "https://localhost:8998,https://localhost:8999");
const maxInflight = envInt("PERSONAPLEX_MAX_INFLIGHT_PER_INSTANCE", 1);
const insecureBackendTls = envBool("PERSONAPLEX_BACKEND_INSECURE_TLS", false);
const stickyTtlMs = envInt("PERSONAPLEX_STICKY_TTL_MS", 30 * 60_000);

const pool = poolSpec
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (pool.length === 0) {
  console.error("personaplex-router: PERSONAPLEX_POOL is empty.");
  process.exit(2);
}

// Instance state.
const instances = pool.map((baseUrl, idx) => ({
  idx,
  baseUrl,
  inflight: 0,
  lastUsedAt: 0,
  // We treat instances as healthy unless we observe connection failures.
  // This is conservative: saturation is handled via inflight accounting + 429.
  healthy: true,
  lastError: "",
}));

// Sticky assignments: sessionKey -> { idx, expiresAt }
const sticky = new Map();

function now() {
  return Date.now();
}

function cleanSticky() {
  const t = now();
  for (const [k, v] of sticky.entries()) {
    if (!v || typeof v.expiresAt !== "number" || v.expiresAt <= t) sticky.delete(k);
  }
}

setInterval(cleanSticky, 15_000).unref();

function pickInstance(sessionKey) {
  const t = now();

  // Honor sticky mapping if still valid.
  const stickyEntry = sticky.get(sessionKey);
  if (stickyEntry && stickyEntry.expiresAt > t) {
    const inst = instances[stickyEntry.idx];
    if (inst && inst.healthy && inst.inflight < maxInflight) return inst;
    // Sticky target unavailable or saturated: fail fast (backpressure) rather than silently breaking stickiness.
    return null;
  }

  // Choose least-loaded healthy instance.
  let best = null;
  for (const inst of instances) {
    if (!inst.healthy) continue;
    if (inst.inflight >= maxInflight) continue;
    if (!best) best = inst;
    else if (inst.inflight < best.inflight) best = inst;
    else if (inst.inflight === best.inflight && inst.lastUsedAt < best.lastUsedAt) best = inst;
  }
  if (!best) return null;

  sticky.set(sessionKey, { idx: best.idx, expiresAt: t + stickyTtlMs });
  return best;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function reply429(socket) {
  try {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\n\r\n");
  } catch {}
  try {
    socket.destroy();
  } catch {}
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && u.pathname === "/health") {
    const ok = instances.some((i) => i.healthy);
    return json(res, ok ? 200 : 503, {
      ok,
      poolSize: instances.length,
      maxInflight,
      instances: instances.map((i) => ({
        idx: i.idx,
        baseUrl: i.baseUrl,
        healthy: i.healthy,
        inflight: i.inflight,
        lastUsedAt: i.lastUsedAt,
        lastError: i.lastError || undefined,
      })),
    });
  }
  if (req.method === "GET" && u.pathname === "/instances") {
    return json(res, 200, {
      ok: true,
      poolSize: instances.length,
      maxInflight,
      stickySize: sticky.size,
      instances: instances.map((i) => ({
        idx: i.idx,
        baseUrl: i.baseUrl,
        healthy: i.healthy,
        inflight: i.inflight,
        lastUsedAt: i.lastUsedAt,
        lastError: i.lastError || undefined,
      })),
    });
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url || "/", "http://localhost");
  if (u.pathname !== "/api/chat") {
    // Only proxy the PersonaPlex WS endpoint.
    return reply429(socket);
  }

  const sessionKey = String(req.headers["x-session-key"] || "").trim() || "default";
  const inst = pickInstance(sessionKey);
  if (!inst) return reply429(socket);

  // Accept client WS first, then connect upstream.
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const upstreamUrl = new URL(inst.baseUrl);
    const targetWsUrl = (() => {
      const proto = upstreamUrl.protocol === "https:" ? "wss:" : upstreamUrl.protocol === "http:" ? "ws:" : upstreamUrl.protocol;
      // Preserve full path + query string from the incoming request.
      return `${proto}//${upstreamUrl.host}${u.pathname}${u.search}`;
    })();

    inst.inflight += 1;
    inst.lastUsedAt = now();

    const upstreamWs = new WebSocket(targetWsUrl, {
      perMessageDeflate: false,
      rejectUnauthorized: insecureBackendTls ? false : undefined,
      headers: {
        // Preserve session key for observability downstream (router -> instance).
        "X-Session-Key": sessionKey,
      },
    });

    const cleanup = (why) => {
      if (clientWs.__cleanedUp) return;
      clientWs.__cleanedUp = true;
      inst.inflight = Math.max(0, inst.inflight - 1);
      if (why) inst.lastError = String(why);
      try {
        clientWs.close();
      } catch {}
      try {
        upstreamWs.close();
      } catch {}
    };

    clientWs.on("message", (data, isBinary) => {
      try {
        upstreamWs.send(data, { binary: isBinary });
      } catch {}
    });
    upstreamWs.on("message", (data, isBinary) => {
      try {
        clientWs.send(data, { binary: isBinary });
      } catch {}
    });

    clientWs.on("close", () => cleanup("client_close"));
    clientWs.on("error", (e) => cleanup(`client_error:${e?.message || e}`));
    upstreamWs.on("close", () => cleanup("upstream_close"));
    upstreamWs.on("error", (e) => {
      inst.healthy = false;
      cleanup(`upstream_error:${e?.message || e}`);
    });

    // If upstream fails to open quickly, backpressure future requests by marking unhealthy;
    // sticky assignments will also fail fast with 429.
    upstreamWs.on("open", () => {
      inst.healthy = true;
      inst.lastError = "";
    });
  });
});

server.listen(port, () => {
  console.log("personaplex-router: listening", { port, pool, maxInflight, insecureBackendTls, stickyTtlMs });
  console.log("personaplex-router: endpoints", { health: `http://localhost:${port}/health`, instances: `http://localhost:${port}/instances` });
});

