/**
 * Turn Coordinator: HTTP service for multi-agent turn-taking.
 * Run as a separate process. Agents GET /recent-turns, POST /request-turn, poll GET /turn-decision, POST /end-turn.
 */

import * as http from "http";
import type { CoordinatorTurn, PendingBucket, PendingEntry } from "./types";

const DEFAULT_PORT = 3001;
const COLLECTION_MS = 300;
const MAX_RECENT_TURNS = 50;

function getEnv(key: string, defaultValue?: string): string | undefined {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v.trim();
}

/** Parse COORDINATOR_AGENTS=alex:Alex,jamie:Jamie into ordered [{ id, displayName }]. */
function parseAgentsConfig(s: string | undefined): PendingEntry[] {
  if (!s) return [];
  return s.split(",").map((pair) => {
    const [id, displayName] = pair.split(":").map((x) => x.trim());
    return { agentId: id || "unknown", displayName: displayName || id || "unknown" };
  });
}

const agentsOrder: PendingEntry[] = parseAgentsConfig(getEnv("COORDINATOR_AGENTS"));
const agentOrderIds = agentsOrder.map((a) => a.agentId);
const discoveredOrder: string[] = [];

let currentSpeaker: string | null = null;
let lastRespondentIndex = -1;
const recentTurns: CoordinatorTurn[] = [];
const pendingRequests = new Map<string, PendingBucket>();
const decisions = new Map<string, Record<string, boolean>>();

function runSelection(_requestId: string, bucket: PendingBucket): string {
  const transcriptLower = bucket.transcript.toLowerCase();
  const requestedEntries = bucket.entries;

  for (const entry of requestedEntries) {
    const name = (entry.displayName || "").toLowerCase();
    if (name && transcriptLower.includes(name)) {
      return entry.agentId;
    }
  }

  const order = agentOrderIds.length > 0 ? agentOrderIds : discoveredOrder;
  if (order.length > 0 && requestedEntries.length > 0) {
    for (let i = 1; i <= order.length; i++) {
      const nextIndex = (lastRespondentIndex + i) % order.length;
      const nextId = order[nextIndex];
      if (requestedEntries.some((e) => e.agentId === nextId)) {
        lastRespondentIndex = nextIndex;
        return nextId;
      }
    }
  }

  if (agentOrderIds.length === 0) {
    for (const e of requestedEntries) {
      if (!discoveredOrder.includes(e.agentId)) discoveredOrder.push(e.agentId);
    }
  }

  lastRespondentIndex = (lastRespondentIndex + 1) % Math.max(1, requestedEntries.length);
  return requestedEntries[lastRespondentIndex % requestedEntries.length]?.agentId ?? requestedEntries[0].agentId;
}

function flushRequest(requestId: string): void {
  const bucket = pendingRequests.get(requestId);
  if (!bucket) return;
  if (bucket.timer) clearTimeout(bucket.timer);
  pendingRequests.delete(requestId);

  if (currentSpeaker !== null) {
    decisions.set(requestId, Object.fromEntries(bucket.entries.map((e) => [e.agentId, false])));
    return;
  }

  const chosenId = runSelection(requestId, bucket);
  currentSpeaker = chosenId;
  const decision: Record<string, boolean> = {};
  for (const e of bucket.entries) {
    decision[e.agentId] = e.agentId === chosenId;
  }
  decisions.set(requestId, decision);
}

function scheduleFlush(requestId: string): void {
  const bucket = pendingRequests.get(requestId);
  if (!bucket || bucket.timer) return;
  const timer = setTimeout(() => {
    flushRequest(requestId);
  }, COLLECTION_MS);
  bucket.timer = timer;
  (timer as NodeJS.Timeout).unref?.();
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "";

  if (method === "GET" && (url === "/recent-turns" || url.startsWith("/recent-turns?"))) {
    sendJson(res, 200, { turns: recentTurns, maxTurns: MAX_RECENT_TURNS });
    return;
  }

  if (method === "GET" && url.startsWith("/turn-decision")) {
    const u = new URL(url, "http://localhost");
    const requestId = u.searchParams.get("requestId") ?? "";
    const agentId = u.searchParams.get("agentId") ?? "";
    const decision = decisions.get(requestId);
    if (!decision) {
      sendJson(res, 200, { decided: false });
      return;
    }
    const allowed = decision[agentId];
    sendJson(res, 200, { decided: true, allowed: allowed === true });
    return;
  }

  if (method === "POST" && url === "/request-turn") {
    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : agentId;
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";

    if (!agentId || !requestId) {
      sendJson(res, 400, { error: "Missing agentId or requestId" });
      return;
    }

    if (currentSpeaker !== null) {
      sendJson(res, 200, { pending: false, allowed: false });
      return;
    }

    let bucket = pendingRequests.get(requestId);
    if (!bucket) {
      bucket = { entries: [], transcript, createdAt: Date.now() };
      pendingRequests.set(requestId, bucket);
      scheduleFlush(requestId);
    }
    if (!bucket.entries.some((e) => e.agentId === agentId)) {
      bucket.entries.push({ agentId, displayName });
    }

    sendJson(res, 200, { pending: true });
    return;
  }

  if (method === "POST" && url === "/end-turn") {
    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const userMessage = typeof body.userMessage === "string" ? body.userMessage : "";
    const assistantMessage = typeof body.assistantMessage === "string" ? body.assistantMessage : "";

    if (!agentId) {
      sendJson(res, 400, { error: "Missing agentId" });
      return;
    }

    currentSpeaker = null;
    recentTurns.push({ user: userMessage, assistant: assistantMessage });
    while (recentTurns.length > MAX_RECENT_TURNS) {
      recentTurns.shift();
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end();
});

const port = parseInt(getEnv("COORDINATOR_PORT") ?? String(DEFAULT_PORT), 10);
const listenPort = Number.isNaN(port) ? DEFAULT_PORT : port;
server.listen(listenPort, () => {
  console.log(`Turn Coordinator listening on port ${listenPort}`);
});

export { server };
