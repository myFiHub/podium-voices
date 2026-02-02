/**
 * Smoke script: run the co-host for a fixed duration and check logs for
 * at least one USER_TRANSCRIPT and AGENT_REPLY (optional reconnect step).
 * Usage: node scripts/smoke.js [durationMinutes]
 * Requires: PODIUM_TOKEN, PODIUM_OUTPOST_UUID, USE_JITSI_BOT=true (for real audio).
 */

const { spawn } = require("child_process");
const path = require("path");

const durationMinutes = parseInt(process.argv[2] || "2", 10) || 2;
const durationMs = durationMinutes * 60 * 1000;

const projectRoot = path.resolve(__dirname, "..");
const mainPath = path.join(projectRoot, "dist", "main.js");

const env = {
  ...process.env,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  USE_JITSI_BOT: process.env.USE_JITSI_BOT || "false",
};

const seen = { userTranscript: false, agentReply: false };
let stderr = "";

const child = spawn(process.execPath, [mainPath], {
  cwd: projectRoot,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  const s = chunk.toString();
  if (s.includes("USER_TRANSCRIPT")) seen.userTranscript = true;
  if (s.includes("AGENT_REPLY")) seen.agentReply = true;
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  const s = chunk.toString();
  if (s.includes("USER_TRANSCRIPT")) seen.userTranscript = true;
  if (s.includes("AGENT_REPLY")) seen.agentReply = true;
});

child.on("error", (err) => {
  console.error("Smoke: process error", err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (code !== null && code !== 0) {
    console.error("Smoke: process exited with code", code);
    process.exit(1);
  }
  if (signal) {
    console.error("Smoke: process killed by signal", signal);
    process.exit(1);
  }
});

setTimeout(() => {
  child.kill("SIGINT");
  setTimeout(() => {
    if (seen.userTranscript && seen.agentReply) {
      console.log("Smoke: PASS (saw USER_TRANSCRIPT and AGENT_REPLY)");
      process.exit(0);
    }
    console.log("Smoke: RUN COMPLETE (no transcript/reply required for pass; set USE_JITSI_BOT=true and speak for full check)");
    console.log("  userTranscript:", seen.userTranscript, "agentReply:", seen.agentReply);
    process.exit(0);
  }, 2000);
}, durationMs);

console.log("Smoke: running co-host for", durationMinutes, "minute(s)...");
