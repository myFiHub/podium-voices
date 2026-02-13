/**
 * Turn Coordinator: HTTP service for multi-agent turn-taking.
 * Run as a separate process. Agents GET /recent-turns, POST /request-turn, poll GET /turn-decision, POST /end-turn.
 * Uses lease-based grants: winner receives turnId and leaseMs; must POST /end-turn with turnId (or lease auto-expires).
 */

import * as crypto from "crypto";
import * as http from "http";
import type { CoordinatorTurn, PendingBucket, PendingEntry, TurnDecisionValue, TurnLease } from "./types";
import { runAward, normalizeBid } from "./auction";

const DEFAULT_PORT = 3001;
const DEFAULT_COLLECTION_MS = 300;
const DEFAULT_LEASE_MS = 120_000;
const MAX_RECENT_TURNS = 50;

function getEnv(key: string, defaultValue?: string): string | undefined {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v.trim();
}

/** Collection window (ms) before turn decision; from COORDINATOR_COLLECTION_MS (default 300). */
function getCollectionMs(): number {
  const s = getEnv("COORDINATOR_COLLECTION_MS");
  if (s === undefined) return DEFAULT_COLLECTION_MS;
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n < 0 ? DEFAULT_COLLECTION_MS : Math.min(n, 60_000);
}

/** Lease duration (ms) for granted turn; from COORDINATOR_LEASE_MS. */
function getLeaseMs(): number {
  const s = getEnv("COORDINATOR_LEASE_MS");
  if (s === undefined) return DEFAULT_LEASE_MS;
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n < 1000 ? DEFAULT_LEASE_MS : Math.min(n, 600_000);
}

function generateTurnId(): string {
  return crypto.randomUUID();
}

function getUseAuction(): boolean {
  const s = (getEnv("COORDINATOR_USE_AUCTION") ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
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
/** Active lease for the current speaker; cleared on end-turn or expiry. */
let currentLease: TurnLease | null = null;
/** Last agent to complete a turn (for auction cooldown). */
let lastSpeakerId: string | null = null;
let lastRespondentIndex = -1;
const recentTurns: CoordinatorTurn[] = [];
const pendingRequests = new Map<string, PendingBucket>();
const decisions = new Map<string, TurnDecisionValue>();

/** If current lease has expired, clear speaker and lease (log event). */
function checkLeaseExpiry(): void {
  if (currentSpeaker === null || currentLease === null) return;
  if (Date.now() < currentLease.expiresAt) return;
  const expiredTurnId = currentLease.turnId;
  currentSpeaker = null;
  currentLease = null;
  console.warn(JSON.stringify({ event: "COORDINATOR_LEASE_EXPIRED", turnId: expiredTurnId }));
}

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
  checkLeaseExpiry();
  const bucket = pendingRequests.get(requestId);
  if (!bucket) return;
  if (bucket.timer) clearTimeout(bucket.timer);
  pendingRequests.delete(requestId);

  if (currentSpeaker !== null) {
    const allowed: Record<string, boolean> = {};
    for (const e of bucket.entries) allowed[e.agentId] = false;
    decisions.set(requestId, { allowed });
    return;
  }

  const useAuction = getUseAuction();
  const transcriptLower = bucket.transcript.toLowerCase();
  let chosenId: string;
  let winnerSelectionReason: string;

  if (useAuction && bucket.entries.some((e) => e.bid != null)) {
    const result = runAward(bucket.entries, transcriptLower, lastSpeakerId, agentOrderIds);
    chosenId = result.winnerId;
    winnerSelectionReason = result.reason;
  } else {
    chosenId = runSelection(requestId, bucket);
    const chosenEntry = bucket.entries.find((e) => e.agentId === chosenId);
    const nameInTranscript = (chosenEntry?.displayName || "").toLowerCase();
    winnerSelectionReason = nameInTranscript && transcriptLower.includes(nameInTranscript) ? "name_addressing" : "round_robin";
  }

  const leaseMs = getLeaseMs();
  const turnId = generateTurnId();
  const expiresAt = Date.now() + leaseMs;
  currentSpeaker = chosenId;
  currentLease = { turnId, leaseMs, expiresAt };

  const allowed: Record<string, boolean> = {};
  for (const e of bucket.entries) allowed[e.agentId] = e.agentId === chosenId;
  decisions.set(requestId, { allowed, turnId, leaseMs, winnerSelectionReason });
}

function scheduleFlush(requestId: string): void {
  const bucket = pendingRequests.get(requestId);
  if (!bucket || bucket.timer) return;
  const collectionMs = getCollectionMs();
  const timer = setTimeout(() => {
    flushRequest(requestId);
  }, collectionMs);
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
    checkLeaseExpiry();
    const u = new URL(url, "http://localhost");
    const requestId = u.searchParams.get("requestId") ?? "";
    const agentId = u.searchParams.get("agentId") ?? "";
    const decision = decisions.get(requestId);
    if (!decision) {
      sendJson(res, 200, { decided: false });
      return;
    }
    const allowed = decision.allowed[agentId] === true;
    const payload: { decided: boolean; allowed: boolean; turnId?: string; leaseMs?: number; winnerSelectionReason?: string } = {
      decided: true,
      allowed,
    };
    if (allowed && decision.turnId != null) payload.turnId = decision.turnId;
    if (allowed && decision.leaseMs != null) payload.leaseMs = decision.leaseMs;
    if (decision.winnerSelectionReason != null) payload.winnerSelectionReason = decision.winnerSelectionReason;
    sendJson(res, 200, payload);
    return;
  }

  if (method === "POST" && url === "/request-turn") {
    checkLeaseExpiry();
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
    const bid = body.bid != null ? normalizeBid(body.bid) : undefined;

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
    const existing = bucket.entries.find((e) => e.agentId === agentId);
    if (!existing) {
      bucket.entries.push({ agentId, displayName, ...(bid != null ? { bid } : {}) });
    } else if (bid != null) {
      existing.bid = bid;
    }

    sendJson(res, 200, { pending: true });
    return;
  }

  if (method === "POST" && url === "/end-turn") {
    checkLeaseExpiry();
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
    const turnId = typeof body.turnId === "string" ? body.turnId : undefined;

    if (!agentId) {
      sendJson(res, 400, { error: "Missing agentId" });
      return;
    }

    // Only clear and append turn if turnId matches current lease (or no lease for backward compat).
    const matchesLease = currentLease === null || (turnId != null && turnId === currentLease.turnId);
    if (matchesLease && currentSpeaker === agentId) {
      lastSpeakerId = agentId;
      currentSpeaker = null;
      currentLease = null;
      recentTurns.push({ user: userMessage, assistant: assistantMessage });
      while (recentTurns.length > MAX_RECENT_TURNS) {
        recentTurns.shift();
      }
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && (url === "/health" || url === "/")) {
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
