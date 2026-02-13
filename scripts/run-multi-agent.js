/**
 * Optional launcher: start Turn Coordinator then N agent processes for Phase 1 multi-agent.
 * Usage: node scripts/run-multi-agent.js [configPath]
 *
 * Supported env for "single source of truth" multi-agent launch:
 * - PODIUM_TOKENS=token1,token2,... (preferred), or PODIUM_TOKEN_1/PODIUM_TOKEN_2/... (alternative)
 * - AGENT_IDS=alex,jamie
 * - AGENT_DISPLAY_NAMES=Alex,Jamie
 * - AGENT_PERSONAS=default,hype
 * - PODIUM_OUTPOST_UUIDS=uuid1,uuid2 (optional; fallback to shared PODIUM_OUTPOST_UUID)
 * - HEALTH_PORT_BASE=8080 (auto-assigns HEALTH_PORT per agent: base + index)
 *
 * Backward compatible with:
 * - COORDINATOR_AGENTS=alex:Alex,jamie:Jamie
 * - Single PODIUM_TOKEN/PODIUM_OUTPOST_UUID inherited by all agents.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const coordinatorPath = path.join(projectRoot, "dist", "coordinator", "index.js");
const mainPath = path.join(projectRoot, "dist", "main.js");

const pidDir = path.join(projectRoot, "logs", "pids");
function ensurePidDir() {
  try {
    if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir, { recursive: true });
  } catch (e) {
    // Non-fatal; PID files are best-effort.
    console.warn("Warning: could not create PID dir:", pidDir, e.message);
  }
}
function pidPath(name) {
  return path.join(pidDir, name);
}
function writePid(name, pid) {
  try {
    ensurePidDir();
    fs.writeFileSync(pidPath(name), String(pid), "utf8");
  } catch (e) {
    console.warn("Warning: could not write PID file:", name, e.message);
  }
}
function removePid(name) {
  try {
    const p = pidPath(name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    // ignore
  }
}

let config = {
  coordinatorPort: parseInt(process.env.COORDINATOR_PORT || "3001", 10) || 3001,
  agents: [],
};

function parseCsv(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseNumberedEnv(prefix) {
  const matches = Object.keys(process.env)
    .filter((k) => k.startsWith(`${prefix}_`))
    .map((k) => {
      const idxRaw = k.slice(prefix.length + 1);
      const idx = parseInt(idxRaw, 10);
      if (Number.isNaN(idx)) return null;
      const value = (process.env[k] || "").trim();
      return { idx, value };
    })
    .filter((x) => x && x.value);
  matches.sort((a, b) => a.idx - b.idx);
  return matches.map((m) => m.value);
}

function inferAgentsFromLists() {
  const ids = parseCsv(process.env.AGENT_IDS);
  const displayNames = parseCsv(process.env.AGENT_DISPLAY_NAMES);
  const personas = parseCsv(process.env.AGENT_PERSONAS);
  const tokens = parseCsv(process.env.PODIUM_TOKENS);
  const numberedTokens = parseNumberedEnv("PODIUM_TOKEN");

  const count = Math.max(ids.length, displayNames.length, personas.length, tokens.length, numberedTokens.length);
  if (count === 0) return [];

  const agents = [];
  for (let i = 0; i < count; i++) {
    const fallbackId = `agent${i + 1}`;
    const id = ids[i] || fallbackId;
    const displayName = displayNames[i] || id;
    const personaId = personas[i] || (i === 0 ? "default" : "hype");
    agents.push({ agentId: id, displayName, personaId });
  }
  return agents;
}

const configPath = process.argv[2];
if (configPath && fs.existsSync(configPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (data.coordinatorPort != null) config.coordinatorPort = data.coordinatorPort;
    if (Array.isArray(data.agents)) config.agents = data.agents;
  } catch (e) {
    console.error("Failed to load config:", e.message);
    process.exit(1);
  }
}

if (config.agents.length === 0) {
  const inferred = inferAgentsFromLists();
  if (inferred.length > 0) config.agents = inferred;
}

if (config.agents.length === 0 && process.env.COORDINATOR_AGENTS) {
  const pairs = process.env.COORDINATOR_AGENTS.split(",").map((s) => s.trim());
  config.agents = pairs.map((p) => {
    const [id, name] = p.split(":").map((x) => x.trim());
    return { agentId: id || "agent", displayName: name || id || "Agent", personaId: "default" };
  });
}

if (config.agents.length === 0) {
  config.agents = [
    { agentId: "alex", displayName: "Alex", personaId: "default" },
    { agentId: "jamie", displayName: "Jamie", personaId: "hype" },
  ];
}

const coordinatorUrl = `http://localhost:${config.coordinatorPort}`;
const tokenList = (() => {
  const fromCsv = parseCsv(process.env.PODIUM_TOKENS);
  if (fromCsv.length > 0) return fromCsv;
  return parseNumberedEnv("PODIUM_TOKEN");
})();
const outpostList = (() => {
  const fromCsv = parseCsv(process.env.PODIUM_OUTPOST_UUIDS);
  if (fromCsv.length > 0) return fromCsv;
  return parseNumberedEnv("PODIUM_OUTPOST_UUID");
})();
const personaList = parseCsv(process.env.AGENT_PERSONAS);

const coord = spawn(process.execPath, [coordinatorPath], {
  cwd: projectRoot,
  env: { ...process.env, COORDINATOR_PORT: String(config.coordinatorPort), COORDINATOR_AGENTS: config.agents.map((a) => `${a.agentId}:${a.displayName}`).join(",") },
  stdio: "inherit",
});
writePid("coordinator.pid", coord.pid);
coord.on("error", (err) => {
  console.error("Coordinator failed to start:", err);
  process.exit(1);
});
coord.on("exit", (code) => {
  removePid("coordinator.pid");
  if (code !== 0 && code !== null) process.exit(code);
});

setTimeout(() => {
  const children = [];
  const basePort = (() => {
    // If JITSI_BRIDGE_PORT is set, treat it as the base and allocate per agent deterministically.
    // This prevents port churn when multiple bots run concurrently.
    const raw = process.env.JITSI_BRIDGE_PORT;
    const n = raw != null && raw !== "" ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(n) && n >= 0) return n;
    return 8766;
  })();
  const healthPortBase = (() => {
    const raw = process.env.HEALTH_PORT_BASE || process.env.HEALTH_PORT;
    const n = raw != null && raw !== "" ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(n) && n >= 0) return n;
    return 8080;
  })();
  const perAgentPorts = {};
  const perAgentHealthPorts = {};

  if (tokenList.length > 0 && tokenList.length < config.agents.length) {
    console.warn(
      `Warning: only ${tokenList.length} token(s) provided for ${config.agents.length} agents. Remaining agents will reuse PODIUM_TOKEN if set.`
    );
  }

  for (const agent of config.agents) {
    const idx = children.length;
    const assignedPort = basePort === 0 ? 0 : (basePort + idx);
    const assignedHealthPort = healthPortBase + idx;
    const assignedToken = tokenList[idx] || process.env.PODIUM_TOKEN;
    const assignedOutpostUuid = outpostList[idx] || process.env.PODIUM_OUTPOST_UUID;
    const assignedPersonaId = personaList[idx] || agent.personaId || "default";

    if (!assignedToken) {
      console.error(`Agent ${agent.agentId}: missing token. Set PODIUM_TOKENS/PODIUM_TOKEN_# or PODIUM_TOKEN.`);
      process.exit(1);
    }
    if (!assignedOutpostUuid) {
      console.error(`Agent ${agent.agentId}: missing outpost UUID. Set PODIUM_OUTPOST_UUIDS/PODIUM_OUTPOST_UUID_# or PODIUM_OUTPOST_UUID.`);
      process.exit(1);
    }

    perAgentPorts[agent.agentId] = assignedPort;
    perAgentHealthPorts[agent.agentId] = assignedHealthPort;
    const env = {
      ...process.env,
      COORDINATOR_URL: coordinatorUrl,
      AGENT_ID: agent.agentId,
      AGENT_DISPLAY_NAME: agent.displayName,
      PERSONA_ID: assignedPersonaId,
      PODIUM_TOKEN: assignedToken,
      PODIUM_OUTPOST_UUID: assignedOutpostUuid,
      HEALTH_PORT: String(assignedHealthPort),
      // Deterministic bridge port per agent to avoid collisions.
      JITSI_BRIDGE_PORT: String(assignedPort),
    };
    const child = spawn(process.execPath, [mainPath], { cwd: projectRoot, env, stdio: "inherit" });
    child.on("error", (err) => console.error(`Agent ${agent.agentId} failed to start:`, err));
    writePid(`agent_${agent.agentId}.pid`, child.pid);
    child.on("exit", () => removePid(`agent_${agent.agentId}.pid`));
    children.push(child);
  }

  console.log("Multi-agent: bridge ports assigned:", perAgentPorts);
  console.log("Multi-agent: health ports assigned:", perAgentHealthPorts);

  process.on("SIGINT", () => {
    children.forEach((c) => c.kill("SIGINT"));
    coord.kill("SIGINT");
    process.exit(0);
  });
}, 1500);
