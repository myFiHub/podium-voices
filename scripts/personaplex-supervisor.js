#!/usr/bin/env node
/**
 * PersonaPlex multi-instance supervisor.
 *
 * Why this exists:
 * - PersonaPlex is effectively single-flight (single-capacity “brain”).
 * - For multi-bot E2E and production scaling, we run multiple instances on distinct ports.
 * - We need predictable lifecycle (up/status/down), PID tracking, and minimal cleanup.
 *
 * Usage (from repo root):
 *   node scripts/personaplex-supervisor.js up --instances 2 --base-port 8998
 *   node scripts/personaplex-supervisor.js status
 *   node scripts/personaplex-supervisor.js down
 *
 * Optional flags:
 *   --personaplex-dir /mnt/d/personaplex
 *   --hf-cache /mnt/d/hf_cache
 *   --python python3
 *   --cpu-offload
 *   --host 0.0.0.0
 *   --ports 8998,8999          (for down/status filters)
 *
 * Notes:
 * - Loads `.env.local` via dotenv so HF_TOKEN can be provided there.
 * - Writes PID + metadata into `logs/pids/personaplex-<port>.{pid,json}`.
 * - Uses SIGINT then SIGKILL for shutdown.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { config: loadEnv } = require("dotenv");

const repoRoot = path.resolve(__dirname, "..");
try {
  loadEnv({ path: path.join(repoRoot, ".env.local") });
} catch {
  // best-effort; env may already be exported
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeText(p, s) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, s, "utf8");
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function isAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parsePortsFilter(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  const ports = s
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ports.length > 0 ? new Set(ports) : null;
}

function pidDir() {
  return path.join(repoRoot, "logs", "pids");
}

function metaPathForPort(port) {
  return path.join(pidDir(), `personaplex-${port}.json`);
}

function pidPathForPort(port) {
  return path.join(pidDir(), `personaplex-${port}.pid`);
}

function listKnownInstances() {
  const dir = pidDir();
  ensureDir(dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const metas = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith("personaplex-")) continue;
    if (!e.name.endsWith(".json")) continue;
    const p = path.join(dir, e.name);
    const meta = readJson(p);
    if (meta && typeof meta.port === "number") metas.push(meta);
  }
  metas.sort((a, b) => (a.port || 0) - (b.port || 0));
  return metas;
}

function ensureHfCache(hfCache) {
  const cache = (hfCache || "/mnt/d/hf_cache").trim();
  const hub = path.join(cache, "hub");
  ensureDir(cache);
  ensureDir(hub);
  return { hfHome: cache, hubCache: hub };
}

function mkSslDir(port) {
  // Keep SSL dirs in OS tmp; we record them in meta for cleanup.
  const base = path.join(os.tmpdir(), `personaplex-ssl-${port}-`);
  return fs.mkdtempSync(base);
}

async function killPid(pid, label) {
  if (!isAlive(pid)) return true;
  try {
    console.log(`personaplex: sending SIGINT to ${label} pid=${pid}`);
    process.kill(pid, "SIGINT");
  } catch (e) {
    console.warn(`personaplex: could not SIGINT ${label} pid=${pid}:`, e?.message || String(e));
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(250);
  }
  try {
    console.log(`personaplex: sending SIGKILL to ${label} pid=${pid}`);
    process.kill(pid, "SIGKILL");
  } catch (e) {
    console.warn(`personaplex: could not SIGKILL ${label} pid=${pid}:`, e?.message || String(e));
  }
  await sleep(250);
  return !isAlive(pid);
}

/**
 * Resolve a Python executable that can run `python -m moshi.server`.
 * Tries venv first, then system python3. Ensures PersonaPlex starts even when
 * the venv exists but moshi is not installed there (e.g. only in system site-packages).
 * Returns { python, warn } where warn is a message if no candidate had moshi.server.
 */
function resolvePython(personaplexDir, envOverrides) {
  const venvPython = path.join(personaplexDir, ".venv", "bin", "python");
  const candidates = fs.existsSync(venvPython) ? [venvPython, "python3"] : ["python3"];
  const env = { ...process.env, ...envOverrides };
  for (const py of candidates) {
    const r = spawnSync(py, ["-c", "import moshi.server"], {
      cwd: personaplexDir,
      env,
      stdio: "pipe",
      timeout: 10000,
    });
    if (r.status === 0) return { python: py, warn: null };
  }
  const installHint = `Install moshi in the PersonaPlex venv or system Python, e.g.: cd ${personaplexDir} && pip install ./moshi`;
  return { python: "python3", warn: `personaplex: no Python could import moshi.server. ${installHint}` };
}

async function cmdUp(args) {
  const instances = parseInt(String(args["instances"] ?? "2"), 10);
  const basePort = parseInt(String(args["base-port"] ?? "8998"), 10);
  const host = String(args["host"] ?? "0.0.0.0");
  const personaplexDir = String(args["personaplex-dir"] ?? process.env.PERSONAPLEX_DIR ?? "/mnt/d/personaplex");
  const hfCache = String(args["hf-cache"] ?? process.env.HF_CACHE ?? "/mnt/d/hf_cache");
  const { hfHome, hubCache } = ensureHfCache(hfCache);
  const envOverrides = { HF_HOME: hfHome, HUGGINGFACE_HUB_CACHE: hubCache };
  const resolved = resolvePython(personaplexDir, envOverrides);
  const python = String(args["python"] ?? resolved.python);
  if (resolved.warn) console.warn(resolved.warn);
  const cpuOffload = Boolean(args["cpu-offload"]);

  if (!Number.isFinite(instances) || instances <= 0) die("personaplex: --instances must be a positive integer");
  if (!Number.isFinite(basePort) || basePort <= 0) die("personaplex: --base-port must be a positive integer");
  if (!fs.existsSync(personaplexDir)) die(`personaplex: directory not found: ${personaplexDir}`);
  if (!process.env.HF_TOKEN) die(`personaplex: HF_TOKEN is not set. Add HF_TOKEN=... to ${path.join(repoRoot, ".env.local")} or export it.`);

  console.log("personaplex: HF_HOME =", hfHome);
  console.log("personaplex: HUGGINGFACE_HUB_CACHE =", hubCache);
  console.log("personaplex: PERSONAPLEX_DIR =", personaplexDir);
  console.log("personaplex: PYTHON =", python);

  const ports = [];
  for (let i = 0; i < instances; i++) ports.push(basePort + i);

  for (const port of ports) {
    const metaPath = metaPathForPort(port);
    const oldMeta = readJson(metaPath);
    if (oldMeta?.pid && isAlive(oldMeta.pid)) {
      console.log(`personaplex: already running port=${port} pid=${oldMeta.pid}`);
      continue;
    }

    const sslDir = mkSslDir(port);
    const childArgs = ["-m", "moshi.server", "--ssl", sslDir, "--host", host, "--port", String(port)];
    if (cpuOffload) childArgs.push("--cpu-offload");

    console.log(`personaplex: starting instance port=${port} (sslDir=${sslDir})`);
    const child = spawn(python, childArgs, {
      cwd: personaplexDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HF_HOME: hfHome,
        HUGGINGFACE_HUB_CACHE: hubCache,
      },
      detached: true,
    });

    // Prevent parent from holding the stdio open forever; we persist basic tails via files below.
    const stdoutPath = path.join(repoRoot, "logs", "personaplex", `personaplex-${port}.stdout.log`);
    const stderrPath = path.join(repoRoot, "logs", "personaplex", `personaplex-${port}.stderr.log`);
    ensureDir(path.dirname(stdoutPath));
    ensureDir(path.dirname(stderrPath));
    child.stdout?.pipe(fs.createWriteStream(stdoutPath, { flags: "a" }));
    child.stderr?.pipe(fs.createWriteStream(stderrPath, { flags: "a" }));

    const pid = child.pid;
    if (!pid) die(`personaplex: failed to start instance port=${port} (no pid)`);
    child.unref();

    writeText(pidPathForPort(port), `${pid}\n`);
    writeJson(metaPathForPort(port), {
      kind: "personaplex-instance",
      port,
      pid,
      host,
      python,
      cpuOffload,
      sslDir,
      cwd: personaplexDir,
      startedAt: new Date().toISOString(),
      stdoutPath,
      stderrPath,
      args: childArgs,
    });
    console.log(`personaplex: started port=${port} pid=${pid}`);
  }
}

async function cmdStatus(args) {
  const portsFilter = parsePortsFilter(args["ports"]);
  const metas = listKnownInstances();
  if (metas.length === 0) {
    console.log("personaplex: no instances tracked (no meta files found).");
    return;
  }
  for (const m of metas) {
    if (portsFilter && !portsFilter.has(m.port)) continue;
    const alive = isAlive(m.pid);
    const since = m.startedAt ? `${m.startedAt}` : "unknown";
    console.log(`personaplex: port=${m.port} pid=${m.pid} alive=${alive} startedAt=${since}`);
  }
}

async function cmdDown(args) {
  const portsFilter = parsePortsFilter(args["ports"]);
  const metas = listKnownInstances();
  if (metas.length === 0) {
    console.log("personaplex: nothing to stop (no meta files found).");
    return;
  }
  for (const m of metas) {
    if (portsFilter && !portsFilter.has(m.port)) continue;
    const label = `port=${m.port}`;
    const ok = await killPid(m.pid, label);
    if (!ok) {
      console.warn(`personaplex: WARNING could not stop ${label} pid=${m.pid}`);
    } else {
      console.log(`personaplex: stopped ${label}`);
    }
    // Cleanup: remove pid/meta files (best-effort).
    try {
      fs.unlinkSync(pidPathForPort(m.port));
    } catch {}
    try {
      fs.unlinkSync(metaPathForPort(m.port));
    } catch {}
    // SSL dir cleanup is best-effort; keep it only if you want to debug certs.
    if (m.sslDir) {
      try {
        fs.rmSync(String(m.sslDir), { recursive: true, force: true });
      } catch {}
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = (args._[0] || "").trim();
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log("Usage: node scripts/personaplex-supervisor.js <up|status|down> [--flags]");
    process.exit(0);
  }
  if (cmd === "up") return await cmdUp(args);
  if (cmd === "status") return await cmdStatus(args);
  if (cmd === "down") return await cmdDown(args);
  die(`Unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error("personaplex-supervisor: fatal:", e?.stack || e?.message || String(e));
  process.exit(1);
});

