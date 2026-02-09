#!/usr/bin/env node
/**
 * Whisper-local smoke test (runner/ops validation).
 *
 * What it validates:
 * - Python is available
 * - `scripts/whisper_local_worker.py` can import faster-whisper + load the model
 * - A known speech WAV produces a non-empty transcript (and optionally contains expected phrases)
 *
 * Usage:
 *   node scripts/whisper-local-smoke.js
 *
 * Env:
 *   WHISPER_MODEL=base            (default: base)
 *   WHISPER_ENGINE=faster-whisper (default: faster-whisper)
 *   WHISPER_PYTHON_PATH=python3   (default: python3)
 *   WHISPER_SMOKE_WAV=stimuli/hello_world.wav
 *   WHISPER_SMOKE_EXPECT="hello world"
 *   WHISPER_SMOKE_TIMEOUT_MS=120000
 */

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");
const { config: loadEnv } = require("dotenv");

const repoRoot = path.resolve(__dirname, "..");
try {
  loadEnv({ path: path.join(repoRoot, ".env.local") });
} catch {}

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
function die(msg) {
  console.error(msg);
  process.exit(1);
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const python = envStr("WHISPER_PYTHON_PATH", "python3");
  const engine = envStr("WHISPER_ENGINE", "faster-whisper");
  const model = envStr("WHISPER_MODEL", "base");
  const wavRel = envStr("WHISPER_SMOKE_WAV", "stimuli/hello_world.wav");
  const wavPath = path.resolve(repoRoot, wavRel);
  const expected = envStr("WHISPER_SMOKE_EXPECT", "hello world");
  const timeoutMs = envInt("WHISPER_SMOKE_TIMEOUT_MS", 120_000);

  const workerScript = path.resolve(repoRoot, "scripts", "whisper_local_worker.py");
  if (!fs.existsSync(workerScript)) die(`whisper-local-smoke: worker script missing: ${workerScript}`);

  if (!fs.existsSync(wavPath)) {
    console.log(`whisper-local-smoke: stimulus WAV missing; generating (${wavRel})`);
    const gen = path.resolve(repoRoot, "scripts", "generate-stimuli.js");
    if (!fs.existsSync(gen)) die(`whisper-local-smoke: generator missing: ${gen}`);
    const r = spawnSync(process.execPath, [gen], { cwd: repoRoot, stdio: "inherit" });
    if (r.status !== 0) die(`whisper-local-smoke: stimuli generation failed (exit ${r.status})`);
    if (!fs.existsSync(wavPath)) die(`whisper-local-smoke: stimulus still missing after generation: ${wavPath}`);
  }

  // Fast fail if faster-whisper is missing.
  if (engine === "faster-whisper") {
    const r = spawnSync(python, ["-c", "import faster_whisper; print('OK')"], { encoding: "utf8" });
    if ((r.stdout || "").trim() !== "OK") {
      die(
        "whisper-local-smoke: faster-whisper is not importable. Install with:\n" +
          "  pip install faster-whisper\n" +
          `python stderr: ${(r.stderr || "").trim()}`
      );
    }
  }

  console.log("whisper-local-smoke: starting worker:", { python, engine, model });
  const child = spawn(python, [workerScript, "--engine", engine, "--model", model], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  child.stderr.on("data", (buf) => {
    const msg = buf.toString("utf8").trim();
    if (msg) console.warn("whisper-local-smoke: worker stderr:", msg);
  });

  const rl = readline.createInterface({ input: child.stdout });
  const startedAt = Date.now();

  const readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for READY from worker.")), Math.min(10_000, timeoutMs));
    rl.on("line", (line) => {
      const s = line.trim();
      if (!s) return;
      let obj;
      try {
        obj = JSON.parse(s);
      } catch {
        return;
      }
      if (obj && obj.event === "READY") {
        clearTimeout(timer);
        resolve(obj);
      }
    });
  });

  await readyPromise;
  console.log("whisper-local-smoke: worker READY");

  const req = { id: 1, op: "transcribe", audioPath: wavPath };
  child.stdin.write(JSON.stringify(req) + "\n");

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for transcript result (${timeoutMs}ms).`)), timeoutMs);
    rl.on("line", (line) => {
      const s = line.trim();
      if (!s) return;
      let obj;
      try {
        obj = JSON.parse(s);
      } catch {
        return;
      }
      if (obj && obj.id === 1) {
        clearTimeout(timer);
        resolve(obj);
      }
    });
  });

  const ok = result && result.ok === true;
  if (!ok) {
    try {
      child.kill();
    } catch {}
    die(`whisper-local-smoke: worker returned error: ${JSON.stringify(result)}`);
  }

  const text = (result.result && result.result.text) || "";
  console.log("whisper-local-smoke: transcript:", text);
  if (!text.trim()) {
    die("whisper-local-smoke: transcript was empty.");
  }
  const textNorm = normalize(text);
  const expNorm = normalize(expected);
  if (expNorm && !textNorm.includes(expNorm)) {
    die(`whisper-local-smoke: transcript did not include expected phrase '${expected}'.`);
  }

  console.log(`whisper-local-smoke: PASS (elapsedMs=${Date.now() - startedAt})`);
  try {
    child.kill();
  } catch {}
}

main().catch((e) => die(`whisper-local-smoke: FAIL: ${e?.stack || e?.message || String(e)}`));

