#!/usr/bin/env node
/**
 * voices-kill: cleanup helper to stop stale coordinator/agent processes.
 *
 * Strategy:
 * - Prefer PID files in `logs/pids/*.pid` written by `scripts/run-multi-agent.js`.
 * - Send SIGINT first (graceful), then SIGKILL if still alive after a short wait.
 * - Remove PID files once the process is confirmed dead (or missing).
 *
 * This is intentionally conservative and only targets processes we started (PID-file based),
 * which avoids accidentally killing unrelated Node processes.
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const pidDir = path.join(projectRoot, "logs", "pids");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

async function killPid(pid, label) {
  if (!isAlive(pid)) return { pid, label, status: "not_running" };
  try {
    process.kill(pid, "SIGINT");
  } catch (e) {
    return { pid, label, status: "sigint_failed", error: e.message };
  }

  await sleep(750);
  if (!isAlive(pid)) return { pid, label, status: "sigint_ok" };

  try {
    process.kill(pid, "SIGKILL");
  } catch (e) {
    return { pid, label, status: "sigkill_failed", error: e.message };
  }

  await sleep(250);
  return { pid, label, status: isAlive(pid) ? "still_alive" : "sigkill_ok" };
}

async function main() {
  if (!fs.existsSync(pidDir)) {
    console.log("No PID dir found:", pidDir);
    process.exit(0);
  }

  const files = fs.readdirSync(pidDir).filter((f) => f.endsWith(".pid"));
  if (files.length === 0) {
    console.log("No PID files found in:", pidDir);
    process.exit(0);
  }

  const results = [];
  for (const f of files) {
    const full = path.join(pidDir, f);
    let pid = 0;
    try {
      const raw = fs.readFileSync(full, "utf8").trim();
      pid = parseInt(raw, 10);
    } catch (e) {
      console.warn("Could not read PID file:", full, e.message);
      continue;
    }

    if (!Number.isFinite(pid) || pid <= 0) {
      console.warn("Invalid PID in file, removing:", full);
      try { fs.unlinkSync(full); } catch (e) { /* ignore */ }
      continue;
    }

    const label = f.replace(/\.pid$/, "");
    const r = await killPid(pid, label);
    results.push(r);

    if (r.status === "not_running" || r.status === "sigint_ok" || r.status === "sigkill_ok") {
      try { fs.unlinkSync(full); } catch (e) { /* ignore */ }
    }
  }

  console.log("voices:kill results:");
  for (const r of results) {
    console.log(`- ${r.label} pid=${r.pid}: ${r.status}${r.error ? " (" + r.error + ")" : ""}`);
  }
}

main().catch((e) => {
  console.error("voices:kill failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});

