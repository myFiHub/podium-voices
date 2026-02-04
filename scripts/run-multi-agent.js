/**
 * Optional launcher: start Turn Coordinator then N agent processes for Phase 1 multi-agent.
 * Usage: node scripts/run-multi-agent.js [configPath]
 * Config JSON (optional): { "coordinatorPort": 3001, "agents": [ { "agentId": "alex", "displayName": "Alex", "personaId": "default" }, ... ] }
 * If no config path, uses COORDINATOR_PORT (default 3001) and COORDINATOR_AGENTS env (e.g. alex:Alex,jamie:Jamie) to build two agents.
 * Each agent inherits process.env (PODIUM_TOKEN, etc.); override with COORDINATOR_URL (e.g. http://localhost:3001).
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const coordinatorPath = path.join(projectRoot, "dist", "coordinator", "index.js");
const mainPath = path.join(projectRoot, "dist", "main.js");

let config = {
  coordinatorPort: parseInt(process.env.COORDINATOR_PORT || "3001", 10) || 3001,
  agents: [],
};

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

const coord = spawn(process.execPath, [coordinatorPath], {
  cwd: projectRoot,
  env: { ...process.env, COORDINATOR_PORT: String(config.coordinatorPort), COORDINATOR_AGENTS: config.agents.map((a) => `${a.agentId}:${a.displayName}`).join(",") },
  stdio: "inherit",
});
coord.on("error", (err) => {
  console.error("Coordinator failed to start:", err);
  process.exit(1);
});
coord.on("exit", (code) => {
  if (code !== 0 && code !== null) process.exit(code);
});

setTimeout(() => {
  const children = [];
  for (const agent of config.agents) {
    const env = {
      ...process.env,
      COORDINATOR_URL: coordinatorUrl,
      AGENT_ID: agent.agentId,
      AGENT_DISPLAY_NAME: agent.displayName,
      PERSONA_ID: agent.personaId || "default",
    };
    const child = spawn(process.execPath, [mainPath], { cwd: projectRoot, env, stdio: "inherit" });
    child.on("error", (err) => console.error(`Agent ${agent.agentId} failed to start:`, err));
    children.push(child);
  }
  process.on("SIGINT", () => {
    children.forEach((c) => c.kill("SIGINT"));
    coord.kill("SIGINT");
    process.exit(0);
  });
}, 1500);
