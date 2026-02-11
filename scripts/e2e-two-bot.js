#!/usr/bin/env node
/**
 * Two-bot E2E harness (Tier 2): coordinator + 2 agents + hard audio gates + single JSON report.
 *
 * Goals:
 * - Start a Turn Coordinator and two bot processes.
 * - Enable deterministic outbound stimulus injection for bot A (PCM_STIMULUS_* envs).
 * - Parse structured JSON logs (set NODE_ENV=production in children for JSON output).
 * - Enforce hard gates and write a single machine-readable run report artifact.
 *
 * Hard gates (summary):
 * - JOIN_GATE: BOT_JITSI_JOINED within JOIN timeout (per bot)
 * - RECV_GATE: RECV_GATE_PASSED within RECV timeout (per bot)
 * - STABILITY_GATE: no disconnect/page-close events for STABILITY_MS after join (per bot)
 * - STIMULUS_PUBLISH_GATE: bot A sees health_contract_publish pass:true after stimulus injection
 * - ASR_GATE (conditional): bot B sees USER_TRANSCRIPT textLength>0 after stimulus (speech stimulus only)
 * - TURN_GATE (conditional): bot B sees AGENT_REPLY after transcript (speech stimulus only)
 * - PERSONAPLEX_GATE (preset-driven): PERSONAPLEX_FAILED is fatal only when enabled + policy=fatal.
 *
 * What "PASS" means: All enabled gates were satisfied (e.g. both joined, stability passed,
 * stimulus published, and if TURN/PERSONAPLEX are enabled, at least one bot produced a reply).
 * It does not guarantee multiple back-and-forth turns. For continuous podcast-style conversation
 * use a preset where both bots use the real ASR→LLM→TTS pipeline (e.g. prod-podcast).
 *
 * Usage:
 *   node scripts/e2e-two-bot.js
 *
 * Optional env:
 *   E2E_COORDINATOR_PORT=3001
 *   E2E_AGENTS="alex:Alex,jamie:Jamie"     (2 agents required)
 *   E2E_PERSONAPLEX_URLS="alex:https://localhost:8998,jamie:https://localhost:8999"
 *   E2E_BOT_A_PERSONAPLEX_URL=https://localhost:8998
 *   E2E_BOT_B_PERSONAPLEX_URL=https://localhost:8999
 *   E2E_TOTAL_TIMEOUT_MS=240000
 *   E2E_JOIN_TIMEOUT_MS=90000
 *   E2E_RECV_TIMEOUT_MS=120000
 *   E2E_STABILITY_MS=20000
 *   E2E_REQUIRE_ASR=1                      (force ASR/TURN gates even for tone stimulus)
 *   E2E_REPORT_PATH=artifacts/e2e-two-bot.json
 *
 * Important:
 * - This harness expects real room env to be present (PODIUM_TOKEN, PODIUM_OUTPOST_UUID, USE_JITSI_BOT=true).
 * - It does NOT edit any plan docs; it only produces a report file.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { config: loadEnv } = require("dotenv");

const projectRoot = path.resolve(__dirname, "..");
const distMain = path.join(projectRoot, "dist", "main.js");
const distCoordinator = path.join(projectRoot, "dist", "coordinator", "index.js");

// Load `.env.local` (CRLF-safe) so the harness can be run without `source .env.local`.
// This avoids accidental `\r` suffixes in values (common when sourcing Windows-edited env files in bash),
// which can break libraries like pino that validate LOG_LEVEL strictly.
try {
  loadEnv({ path: path.join(projectRoot, ".env.local") });
} catch {
  // best-effort; harness also supports env already exported by the caller.
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

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envStr(name, fallback = "") {
  const v = (process.env[name] || "").trim();
  return v.length > 0 ? v : fallback;
}
function envBool(name, fallback = false) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on";
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJsonFile(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function validatePreset(preset) {
  const err = (m) => new Error(`E2E preset invalid: ${m}`);
  if (!preset || typeof preset !== "object") throw err("not an object");
  if (preset.version !== 1) throw err(`version must be 1 (got ${String(preset.version)})`);
  if (!preset.id || typeof preset.id !== "string") throw err("missing string 'id'");
  if (!preset.bots || typeof preset.bots !== "object") throw err("missing object 'bots'");
  if (!preset.bots.a || typeof preset.bots.a !== "object") throw err("missing object 'bots.a'");
  if (!preset.bots.b || typeof preset.bots.b !== "object") throw err("missing object 'bots.b'");
  for (const key of ["a", "b"]) {
    const b = preset.bots[key];
    const role = (b.role || "").trim();
    if (!["stimulus", "listener", "full"].includes(role)) throw err(`bots.${key}.role must be stimulus|listener|full`);
    const personaId = (b.personaId || "").trim();
    if (!personaId) throw err(`bots.${key}.personaId is required`);
    const mode = (b.conversationBackend || "").trim();
    if (!["asr-llm-tts", "personaplex"].includes(mode)) throw err(`bots.${key}.conversationBackend must be asr-llm-tts|personaplex`);
    if (mode === "asr-llm-tts") {
      for (const f of ["asrProvider", "modelProvider", "ttsProvider"]) {
        if (!b[f] || typeof b[f] !== "string" || !b[f].trim()) throw err(`bots.${key}.${f} is required for asr-llm-tts`);
      }
    }
  }
  if (preset.timeouts && typeof preset.timeouts !== "object") throw err("timeouts must be an object if present");
  if (preset.gates && typeof preset.gates !== "object") throw err("gates must be an object if present");
  if (preset.gates?.enabled && !Array.isArray(preset.gates.enabled)) throw err("gates.enabled must be an array if present");
  const ppol = (preset.gates?.personaplexFailurePolicy || "").trim();
  if (ppol && !["fatal", "degraded", "ignore"].includes(ppol)) throw err("gates.personaplexFailurePolicy must be fatal|degraded|ignore");
  const stim = preset.stimulus || { mode: "tone" };
  if (!stim || typeof stim !== "object") throw err("stimulus must be an object if present");
  const stimMode = (stim.mode || "tone").trim();
  if (!["tone", "wav"].includes(stimMode)) throw err("stimulus.mode must be tone|wav");
  if (stimMode === "wav") {
    if (!stim.wav || typeof stim.wav !== "string" || !stim.wav.trim()) throw err("stimulus.wav must be a non-empty string when mode=wav");
  }
  if (stim.expectedPhrases !== undefined) {
    if (!Array.isArray(stim.expectedPhrases)) throw err("stimulus.expectedPhrases must be an array of strings if present");
    for (const s of stim.expectedPhrases) {
      if (typeof s !== "string" || !s.trim()) throw err("stimulus.expectedPhrases must contain non-empty strings");
    }
  }
  return preset;
}

function loadPreset(presetId) {
  const id = (presetId || "").trim();
  if (!id) return null;
  const p = path.join(projectRoot, "scripts", "e2e-presets", `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`E2E preset not found: ${p}`);
  const preset = readJsonFile(p);
  return validatePreset(preset);
}

function splitAgents(spec) {
  // "alex:Alex,jamie:Jamie" -> [{agentId, displayName}]
  const pairs = (spec || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const agents = [];
  for (const p of pairs) {
    const [idRaw, nameRaw] = p.split(":");
    const agentId = (idRaw || "").trim();
    const displayName = (nameRaw || agentId || "Agent").trim();
    if (!agentId) continue;
    agents.push({ agentId, displayName });
  }
  return agents;
}

function parseKeyedUrls(spec) {
  // "alex:https://host:8998,jamie:https://host:8999" -> { alex: "...", jamie: "..." }
  const out = {};
  const pairs = (spec || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of pairs) {
    // Split at first ':' so urls with 'https://...' are preserved.
    const idx = p.indexOf(":");
    if (idx <= 0) continue;
    const key = p.slice(0, idx).trim();
    const url = p.slice(idx + 1).trim();
    if (!key || !url) continue;
    out[key] = url;
  }
  return out;
}

function buildDefaultAgents() {
  return [
    { agentId: "alex", displayName: "Alex" },
    { agentId: "jamie", displayName: "Jamie" },
  ];
}

function writeReport(outPath, report) {
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
}

function killTree(children, coord) {
  const procs = [...children, coord].filter(Boolean);
  for (const p of procs) {
    try {
      p.kill("SIGINT");
    } catch {}
  }
  setTimeout(() => {
    for (const p of procs) {
      if (!p || p.killed) continue;
      try {
        p.kill("SIGKILL");
      } catch {}
    }
  }, 3500);
}

function attachLineParser(stream, label, onLine) {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx < 0) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      onLine(label, line);
    }
  });
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const presetId = envStr("E2E_PRESET", "") || (typeof argv["preset"] === "string" ? argv["preset"] : "");
  const preset = loadPreset(presetId);

  const totalTimeoutMs = envInt("E2E_TOTAL_TIMEOUT_MS", preset?.timeouts?.totalMs ?? 240_000);
  const joinTimeoutMs = envInt("E2E_JOIN_TIMEOUT_MS", preset?.timeouts?.joinMs ?? 90_000);
  const recvTimeoutMs = envInt("E2E_RECV_TIMEOUT_MS", preset?.timeouts?.recvMs ?? 120_000);
  const stabilityMs = envInt("E2E_STABILITY_MS", preset?.timeouts?.stabilityMs ?? 20_000);
  const coordinatorPort = envInt("E2E_COORDINATOR_PORT", envInt("COORDINATOR_PORT", 3001));
  const reportPath = envStr("E2E_REPORT_PATH", path.join(projectRoot, "artifacts", `e2e-two-bot-${Date.now()}.json`));
  const requireAsr = envBool("E2E_REQUIRE_ASR", Boolean(preset?.requireAsr));
  const echoChildLogs = envBool("E2E_ECHO_CHILD_LOGS", false);

  const agentSpec = envStr("E2E_AGENTS", envStr("COORDINATOR_AGENTS", ""));
  const agents = splitAgents(agentSpec);
  const bots = agents.length >= 2 ? agents.slice(0, 2) : buildDefaultAgents();
  const botA = bots[0];
  const botB = bots[1];

  const missing = [];
  if (!process.env.PODIUM_TOKEN) missing.push("PODIUM_TOKEN");
  if (!process.env.PODIUM_OUTPOST_UUID) missing.push("PODIUM_OUTPOST_UUID");
  // This is read by config loader; keep it explicit because real audio is required here.
  if (!envBool("USE_JITSI_BOT", false) && !envBool("PODIUM_USE_JITSI_BOT", false)) missing.push("USE_JITSI_BOT=true");
  if (missing.length > 0) {
    console.error("E2E harness missing required env:", missing.join(", "));
    process.exit(2);
  }

  // If the preset requires a WAV stimulus and it does not exist, try to generate it.
  if (preset && (preset?.stimulus?.mode || "").trim() === "wav" && typeof preset?.stimulus?.wav === "string") {
    const wavPath = path.resolve(projectRoot, String(preset.stimulus.wav));
    if (!fs.existsSync(wavPath)) {
      const gen = path.join(projectRoot, "scripts", "generate-stimuli.js");
      if (!fs.existsSync(gen)) {
        console.error("E2E: preset requires WAV stimulus but generator script is missing:", gen);
        process.exit(2);
      }
      console.log("E2E: stimulus WAV missing; generating via scripts/generate-stimuli.js ...");
      const r = spawnSync(process.execPath, [gen], { cwd: projectRoot, stdio: "inherit" });
      if (r.status !== 0) process.exit(r.status || 2);
      if (!fs.existsSync(wavPath)) {
        console.error("E2E: stimulus generation completed but WAV still missing:", wavPath);
        process.exit(2);
      }
    }
  }

  // Build dist if needed (common when running locally from TS).
  if (!fs.existsSync(distMain) || !fs.existsSync(distCoordinator)) {
    console.log("E2E: dist/ missing; running build...");
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    if (r.status !== 0) process.exit(r.status || 1);
  }

  const startedAt = Date.now();
  const report = {
    startedAt: nowIso(),
    endedAt: null,
    durationMs: null,
    ok: false,
    config: {
      preset: preset ? { id: preset.id, version: preset.version, description: preset.description || "" } : null,
      coordinatorPort,
      totalTimeoutMs,
      joinTimeoutMs,
      recvTimeoutMs,
      stabilityMs,
      bots: [botA, botB],
      stimulus: {
        enable: true,
        wav: envStr("PCM_STIMULUS_WAV", "") || null,
        pcm: envStr("PCM_STIMULUS_PCM", "") || null,
      },
      requireAsr,
    },
    gates: {
      JOIN_GATE: { ok: false },
      RECV_GATE: { ok: false },
      STABILITY_GATE: { ok: false },
      STIMULUS_PUBLISH_GATE: { ok: false },
      ASR_GATE: { ok: false, skipped: false },
      TURN_GATE: { ok: false, skipped: false },
      PERSONAPLEX_GATE: { ok: true },
    },
    bots: {
      [botA.agentId]: {},
      [botB.agentId]: {},
    },
    failures: [],
    events: {
      // High-signal timestamps (epoch ms) for correlation; filled as we observe them.
      coordinatorStartedAt: null,
      botAJoinAt: null,
      botBJoinAt: null,
      botARecvGateAt: null,
      botBRecvGateAt: null,
      stimulusAt: null,
      stimulusSource: null,
      publishPassAt: null,
      asrAt: null,
      replyAt: null,
      personaplexFailedAt: null,
    },
    /** Last TURN_METRICS seen (for TTFA, bid phase, etc.); from bot log lines. */
    metrics: null,
    debug: {
      // Captured tail of child process logs (last N lines per stream label).
      // This is crucial for diagnosing early exits (e.g., config errors, join failures).
      tails: {},
    },
  };

  const coordinatorUrl = `http://localhost:${coordinatorPort}`;
  const basePort = (() => {
    const raw = process.env.JITSI_BRIDGE_PORT;
    const n = raw != null && raw !== "" ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(n) && n >= 0) return n;
    return 8766;
  })();

  // Optional: per-bot PersonaPlex routing (for multi-instance).
  const personaplexUrlMap = parseKeyedUrls(envStr("E2E_PERSONAPLEX_URLS", ""));
  const botAPersonaplexUrl = envStr("E2E_BOT_A_PERSONAPLEX_URL", personaplexUrlMap[botA.agentId] || "");
  const botBPersonaplexUrl = envStr("E2E_BOT_B_PERSONAPLEX_URL", personaplexUrlMap[botB.agentId] || "");

  // Gate enablement and PersonaPlex failure policy (preset-driven).
  const gateEnabled = (() => {
    const base = ["JOIN_GATE", "RECV_GATE", "STABILITY_GATE", "STIMULUS_PUBLISH_GATE"];
    // Preserve existing behavior: ASR/TURN is conditional on stimulus type unless explicitly forced.
    // (The actual requireAsrTurn decision is made inside considerFinish based on observed stimulus source.)
    if ((process.env.CONVERSATION_BACKEND || "").trim() === "personaplex") base.push("PERSONAPLEX_GATE");
    if (preset?.gates?.enabled && Array.isArray(preset.gates.enabled) && preset.gates.enabled.length > 0) return new Set(preset.gates.enabled);
    return new Set(base);
  })();
  const personaplexFailurePolicy = (() => {
    const p = (preset?.gates?.personaplexFailurePolicy || "").trim();
    if (p) return p;
    return gateEnabled.has("PERSONAPLEX_GATE") ? "fatal" : "ignore";
  })();

  // Child env: force JSON logs for parsing.
  const commonEnv = {
    ...process.env,
    NODE_ENV: "production",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    COORDINATOR_URL: coordinatorUrl,
  };

  const coord = spawn(process.execPath, [distCoordinator], {
    cwd: projectRoot,
    env: {
      ...commonEnv,
      COORDINATOR_PORT: String(coordinatorPort),
      COORDINATOR_AGENTS: `${botA.agentId}:${botA.displayName},${botB.agentId}:${botB.displayName}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  report.events.coordinatorStartedAt = Date.now();

  const children = [];
  const tailLinesByLabel = new Map();
  const MAX_TAIL_LINES = 200;
  function recordTail(label, line) {
    const arr = tailLinesByLabel.get(label) || [];
    arr.push(line);
    if (arr.length > MAX_TAIL_LINES) arr.splice(0, arr.length - MAX_TAIL_LINES);
    tailLinesByLabel.set(label, arr);
    if (echoChildLogs) {
      // Print raw child logs to parent stdout for live debugging when enabled.
      console.log(label, line);
    }
  }

  function spawnBot(bot, idx, extraEnv) {
    const assignedPort = basePort === 0 ? 0 : basePort + idx;
    const botPersonaplexUrl = bot.agentId === botA.agentId ? botAPersonaplexUrl : bot.agentId === botB.agentId ? botBPersonaplexUrl : "";
    const mergedEnv = {
      ...commonEnv,
      ...extraEnv,
      AGENT_ID: bot.agentId,
      AGENT_DISPLAY_NAME: bot.displayName,
      PERSONA_ID: (extraEnv && extraEnv.PERSONA_ID ? String(extraEnv.PERSONA_ID) : process.env.PERSONA_ID) || "default",
      JITSI_BRIDGE_PORT: String(assignedPort),
    };

    // If the bot is configured to use PersonaPlex, allow per-bot URL overrides.
    // This enables running one PersonaPlex instance per bot without editing `.env.local` between runs.
    if ((mergedEnv.CONVERSATION_BACKEND || "").trim() === "personaplex") {
      if (!mergedEnv.PERSONAPLEX_SERVER_URL && botPersonaplexUrl) {
        mergedEnv.PERSONAPLEX_SERVER_URL = botPersonaplexUrl;
      }
    }
    const child = spawn(process.execPath, [distMain], {
      cwd: projectRoot,
      env: {
        ...mergedEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.__bot = bot;
    child.__assignedPort = assignedPort;
    children.push(child);
    return child;
  }

  // Gate tracking state.
  const state = {
    bot: {
      [botA.agentId]: { joinAt: 0, recvGateAt: 0, stabilityOkAt: 0, badEvents: [] },
      [botB.agentId]: { joinAt: 0, recvGateAt: 0, stabilityOkAt: 0, badEvents: [] },
    },
    stimulus: { at: 0, source: "" },
    publishPassAt: 0,
    asrAt: 0,
    replyAt: 0,
    transcriptText: "",
    /** When policy is degraded, bot that had PERSONAPLEX_FAILED; AGENT_REPLY from this bot counts as gate recovered. */
    personaplexFailedBotId: null,
    /** Last TURN_METRICS payload (from any bot) for report.metrics. */
    lastTurnMetrics: null,
  };

  const STABILITY_BAD_EVENTS = new Set([
    "BOT_PAGE_CLOSED",
    "BOT_BRIDGE_DISCONNECTED",
    "WATCHDOG_WS_UNHEALTHY",
    "BOT_JOIN_ERROR",
    "BOT_JITSI_JOIN_FAILED",
  ]);

  function recordFailure(code, detail) {
    report.failures.push({ code, detail, at: nowIso() });
  }

  function considerFinish() {
    const elapsed = Date.now() - startedAt;
    if (elapsed > totalTimeoutMs) {
      recordFailure("TIMEOUT", `Total timeout exceeded (${totalTimeoutMs}ms)`);
      finalize(false, "timeout");
      return;
    }

    // JOIN + RECV for both.
    const a = state.bot[botA.agentId];
    const b = state.bot[botB.agentId];
    const joinOk = a.joinAt > 0 && b.joinAt > 0;
    const recvOk = a.recvGateAt > 0 && b.recvGateAt > 0;

    // Stability: once each has joined, we require a quiet window.
    const stabilityOk =
      (a.joinAt > 0 && a.stabilityOkAt > 0) &&
      (b.joinAt > 0 && b.stabilityOkAt > 0);

    // Stimulus + publish pass.
    const stimulusOk = state.stimulus.at > 0;
    const publishOk = state.publishPassAt > 0;

    // ASR/TURN: only required for speech-like stimulus, unless forced.
    const stimulusIsTone = state.stimulus.source === "tone" || state.stimulus.source === "";
    const requireAsrTurn = requireAsr || !stimulusIsTone;
    const asrRequired = gateEnabled.has("ASR_GATE") && requireAsrTurn;
    const turnRequired = gateEnabled.has("TURN_GATE") && requireAsrTurn;
    const expectedPhrases = Array.isArray(preset?.stimulus?.expectedPhrases) ? preset.stimulus.expectedPhrases : [];
    const transcriptNorm = normalizeForMatch(state.transcriptText);
    const transcriptMatchesExpected =
      expectedPhrases.length === 0
        ? true
        : expectedPhrases.some((p) => {
            const needle = normalizeForMatch(p);
            return needle.length > 0 && transcriptNorm.includes(needle);
          });

    const asrOk = (!asrRequired || state.asrAt > 0) && (!asrRequired || transcriptMatchesExpected);
    const turnOk = !turnRequired || state.replyAt > 0;

    report.gates.JOIN_GATE.ok = joinOk;
    report.gates.RECV_GATE.ok = recvOk;
    report.gates.RECV_GATE.skipped = !gateEnabled.has("RECV_GATE");
    report.gates.STABILITY_GATE.ok = stabilityOk;
    report.gates.STIMULUS_PUBLISH_GATE.ok = stimulusOk && publishOk;
    report.gates.ASR_GATE.ok = asrOk;
    report.gates.TURN_GATE.ok = turnOk;
    report.gates.ASR_GATE.skipped = !asrRequired;
    report.gates.TURN_GATE.skipped = !turnRequired;
    report.gates.PERSONAPLEX_GATE.skipped = !gateEnabled.has("PERSONAPLEX_GATE");

    const okByGate = (gate, ok) => !gateEnabled.has(gate) || ok;
    const stimulusPublishOk = stimulusOk && publishOk;
    if (
      okByGate("JOIN_GATE", joinOk) &&
      okByGate("RECV_GATE", recvOk) &&
      okByGate("STABILITY_GATE", stabilityOk) &&
      okByGate("STIMULUS_PUBLISH_GATE", stimulusPublishOk) &&
      okByGate("ASR_GATE", asrOk) &&
      okByGate("TURN_GATE", turnOk) &&
      okByGate("PERSONAPLEX_GATE", report.gates.PERSONAPLEX_GATE.ok)
    ) {
      finalize(true, "all_gates_passed");
    }
  }

  let finalized = false;
  function finalize(ok, reason) {
    if (finalized) return;
    finalized = true;
    report.ok = Boolean(ok);
    report.endedAt = nowIso();
    report.durationMs = Date.now() - startedAt;

    report.events.botAJoinAt = state.bot[botA.agentId].joinAt || null;
    report.events.botBJoinAt = state.bot[botB.agentId].joinAt || null;
    report.events.botARecvGateAt = state.bot[botA.agentId].recvGateAt || null;
    report.events.botBRecvGateAt = state.bot[botB.agentId].recvGateAt || null;
    report.events.stimulusAt = state.stimulus.at || null;
    report.events.stimulusSource = state.stimulus.source || null;
    report.events.publishPassAt = state.publishPassAt || null;
    report.events.asrAt = state.asrAt || null;
    report.events.replyAt = state.replyAt || null;
    report.metrics = state.lastTurnMetrics;

    // Include captured tails in the report artifact.
    try {
      const tailsObj = {};
      for (const [label, lines] of tailLinesByLabel.entries()) {
        tailsObj[label] = lines;
      }
      report.debug.tails = tailsObj;
    } catch {}

    writeReport(reportPath, report);

    console.log("E2E:", ok ? "PASS" : "FAIL", "-", reason);
    console.log("E2E report:", reportPath);
    if (!ok) {
      // Print a compact tail for the most relevant streams.
      const interesting = [
        `[${botA.agentId}]`,
        `[${botA.agentId}:err]`,
        `[${botB.agentId}]`,
        `[${botB.agentId}:err]`,
        "[coordinator]",
        "[coordinator:err]",
      ];
      for (const label of interesting) {
        const lines = tailLinesByLabel.get(label);
        if (!lines || lines.length === 0) continue;
        console.log(`--- tail ${label} (${lines.length} lines) ---`);
        for (const ln of lines.slice(-60)) console.log(ln);
      }
    }
    killTree(children, coord);

    // Ensure the report hits disk before exit.
    setTimeout(() => process.exit(ok ? 0 : 1), 750);
  }

  function onLog(label, line) {
    // Always capture tails even if not JSON parseable.
    recordTail(label, line);
    const obj = safeJsonParse(line);
    if (!obj || typeof obj !== "object") return;
    const ev = obj.event;
    if (!ev || typeof ev !== "string") return;

    // Identify which bot the log line belongs to (based on label).
    const isA = label.includes(`[${botA.agentId}]`);
    const isB = label.includes(`[${botB.agentId}]`);
    const botId = isA ? botA.agentId : isB ? botB.agentId : null;

    // PersonaPlex failure policy (preset-driven).
    if (ev === "PERSONAPLEX_FAILED") {
      report.gates.PERSONAPLEX_GATE.ok = false;
      report.events.personaplexFailedAt = Date.now();
      if (botId && personaplexFailurePolicy === "degraded") state.personaplexFailedBotId = botId;
      recordFailure("PERSONAPLEX_FAILED", { label, err: obj.err, failureType: obj.failureType });
      if (personaplexFailurePolicy === "fatal") {
        finalize(false, "personaplex_failed");
        return;
      }
    }

    // When policy is degraded, AGENT_REPLY from the bot that had PersonaPlex failure counts as gate recovered (fallback succeeded).
    if (ev === "AGENT_REPLY" && botId && personaplexFailurePolicy === "degraded" && state.personaplexFailedBotId === botId) {
      report.gates.PERSONAPLEX_GATE.ok = true;
      state.personaplexFailedBotId = null;
    }

    if (botId) {
      const s = state.bot[botId];
      if (ev === "BOT_JITSI_JOINED" && s.joinAt === 0) {
        s.joinAt = Date.now();
      }
      if (ev === "RECV_GATE_PASSED" && s.recvGateAt === 0) {
        s.recvGateAt = Date.now();
      }
      if (STABILITY_BAD_EVENTS.has(ev)) {
        s.badEvents.push({ event: ev, at: Date.now(), detail: obj });
      }
      if (s.joinAt > 0 && s.stabilityOkAt === 0) {
        // Once the stability window elapses without a bad event, mark stable.
        const sinceJoin = Date.now() - s.joinAt;
        const badAfterJoin = s.badEvents.some((e) => e.at >= s.joinAt && e.at <= s.joinAt + stabilityMs);
        if (sinceJoin >= stabilityMs && !badAfterJoin) s.stabilityOkAt = Date.now();
      }
    }

    // Stimulus injection (only bot A should emit this in harness runs).
    if (ev === "PCM_STIMULUS_INJECT" && state.stimulus.at === 0) {
      state.stimulus.at = Date.now();
      state.stimulus.source = typeof obj.source === "string" ? obj.source : "";
    }

    // Publish pass gate.
    if (ev === "health_contract_publish" && obj.pass === true && state.publishPassAt === 0) {
      state.publishPassAt = Date.now();
    }

    // ASR/TURN gates: bot B should transcribe and reply (if stimulus is speech).
    if (ev === "TURN_METRICS" && botId) {
      state.lastTurnMetrics = {
        endOfUserSpeechToBotAudioMs: obj.end_of_user_speech_to_bot_audio_ms,
        bidPhaseMs: obj.bid_phase_ms,
        winnerSelectionReason: obj.winner_selection_reason,
        bargeInStopLatencyMs: obj.barge_in_stop_latency_ms,
        turnId: obj.turn_id,
        requestId: obj.request_id,
        asrLatencyMs: obj.asr_latency_ms,
        llmLatencyMs: obj.llm_latency_ms,
        ttsLatencyMs: obj.tts_latency_ms,
      };
    }
    if (ev === "USER_TRANSCRIPT" && state.asrAt === 0) {
      const len = typeof obj.textLength === "number" ? obj.textLength : 0;
      if (len > 0) {
        state.asrAt = Date.now();
        if (typeof obj.text === "string" && obj.text.trim()) state.transcriptText = obj.text;
      }
    }
    if (ev === "AGENT_REPLY" && state.replyAt === 0) {
      const len = typeof obj.textLength === "number" ? obj.textLength : 0;
      if (len > 0) state.replyAt = Date.now();
    }

    considerFinish();
  }

  // Coordinator output is mostly non-JSON; still attach in case it emits structured events later.
  attachLineParser(coord.stdout, "[coordinator]", onLog);
  attachLineParser(coord.stderr, "[coordinator:err]", onLog);
  coord.on("exit", (code, signal) => {
    if (finalized) return;
    recordFailure("COORDINATOR_EXIT", { code, signal });
    finalize(false, "coordinator_exit");
  });

  // Start bots after coordinator warms up.
  setTimeout(() => {
    let botAEnv;
    let botBEnv;

    if (preset) {
      const presetStimulusMode = (preset?.stimulus?.mode || "tone").trim();
      const presetStimulusWav =
        presetStimulusMode === "wav" && preset?.stimulus?.wav ? path.resolve(projectRoot, String(preset.stimulus.wav)) : "";

      const a = preset.bots.a;
      const b = preset.bots.b;

      botAEnv = {
        PCM_STIMULUS_AGENT_ID: botA.agentId,
        PCM_STIMULUS_ENABLE: a.role === "stimulus" ? "1" : "0",
        PERSONA_ID: a.personaId,
        CONVERSATION_BACKEND: a.conversationBackend,
      };
      if (presetStimulusWav && botAEnv.PCM_STIMULUS_ENABLE === "1") {
        // Override stimulus source for preset runs (speech WAV will be added in later presets).
        botAEnv.PCM_STIMULUS_WAV = presetStimulusWav;
      }
      if (botAEnv.CONVERSATION_BACKEND === "asr-llm-tts") {
        botAEnv.ASR_PROVIDER = a.asrProvider;
        botAEnv.MODEL_PROVIDER = a.modelProvider;
        botAEnv.TTS_PROVIDER = a.ttsProvider;
      }
      if (botAEnv.CONVERSATION_BACKEND === "personaplex" && botAPersonaplexUrl) {
        botAEnv.PERSONAPLEX_SERVER_URL = botAPersonaplexUrl;
      }

      botBEnv = {
        PCM_STIMULUS_AGENT_ID: botA.agentId,
        PCM_STIMULUS_ENABLE: b.role === "stimulus" ? "1" : "0",
        PERSONA_ID: b.personaId,
        CONVERSATION_BACKEND: b.conversationBackend,
        // Enable transcript text logging for presets that assert expected phrases.
        E2E_LOG_TRANSCRIPT_TEXT: Array.isArray(preset?.stimulus?.expectedPhrases) && preset.stimulus.expectedPhrases.length > 0 ? "1" : "0",
      };
      if (presetStimulusWav && botBEnv.PCM_STIMULUS_ENABLE === "1") {
        botBEnv.PCM_STIMULUS_WAV = presetStimulusWav;
      }
      if (botBEnv.CONVERSATION_BACKEND === "asr-llm-tts") {
        botBEnv.ASR_PROVIDER = b.asrProvider;
        botBEnv.MODEL_PROVIDER = b.modelProvider;
        botBEnv.TTS_PROVIDER = b.ttsProvider;
      }
      if (botBEnv.CONVERSATION_BACKEND === "personaplex" && botBPersonaplexUrl) {
        botBEnv.PERSONAPLEX_SERVER_URL = botBPersonaplexUrl;
      }
    } else {
      botAEnv = {
        // Deterministic stimulus injection for bot A only.
        PCM_STIMULUS_ENABLE: "1",
        PCM_STIMULUS_AGENT_ID: botA.agentId,
        // IMPORTANT: prevent bot A from consuming PersonaPlex capacity.
        // PersonaPlex server is effectively single-session (global lock); if both bots call it concurrently,
        // one will time out and the strict PERSONAPLEX gate will fail the run.
        //
        // Bot A's job in this harness is to publish deterministic stimulus, not to generate responses.
        CONVERSATION_BACKEND: "asr-llm-tts",
        ASR_PROVIDER: "stub",
        MODEL_PROVIDER: "stub",
        TTS_PROVIDER: "stub",
        // Inherit PCM_STIMULUS_WAV / PCM_STIMULUS_PCM if caller set them.
      };
      botBEnv = {
        // Ensure bot B does not inject stimulus.
        PCM_STIMULUS_ENABLE: "0",
        PCM_STIMULUS_AGENT_ID: botA.agentId,
      };
    }

    // Allow second bot (Jamie) to use a different Podium token for production E2E.
    if (process.env.E2E_BOT_B_PODIUM_TOKEN) {
      botBEnv.PODIUM_TOKEN = process.env.E2E_BOT_B_PODIUM_TOKEN;
    }

    const childA = spawnBot(botA, 0, botAEnv);
    const childB = spawnBot(botB, 1, botBEnv);

    attachLineParser(childA.stdout, `[${botA.agentId}]`, onLog);
    attachLineParser(childA.stderr, `[${botA.agentId}:err]`, onLog);
    attachLineParser(childB.stdout, `[${botB.agentId}]`, onLog);
    attachLineParser(childB.stderr, `[${botB.agentId}:err]`, onLog);

    childA.on("exit", (code, signal) => {
      if (finalized) return;
      recordFailure("BOT_EXIT", { bot: botA.agentId, code, signal });
      finalize(false, "bot_a_exit");
    });
    childB.on("exit", (code, signal) => {
      if (finalized) return;
      recordFailure("BOT_EXIT", { bot: botB.agentId, code, signal });
      finalize(false, "bot_b_exit");
    });

    // Time-based enforcement for join/recv timeouts.
    setInterval(() => {
      if (finalized) return;
      const t = Date.now() - startedAt;
      const a = state.bot[botA.agentId];
      const b = state.bot[botB.agentId];
      if (t > joinTimeoutMs && (!a.joinAt || !b.joinAt)) {
        recordFailure("JOIN_GATE_TIMEOUT", { joinTimeoutMs, botAJoin: a.joinAt, botBJoin: b.joinAt });
        finalize(false, "join_gate_timeout");
        return;
      }
      if (gateEnabled.has("RECV_GATE") && t > recvTimeoutMs && (!a.recvGateAt || !b.recvGateAt)) {
        recordFailure("RECV_GATE_TIMEOUT", { recvTimeoutMs, botARecv: a.recvGateAt, botBRecv: b.recvGateAt });
        finalize(false, "recv_gate_timeout");
        return;
      }
      considerFinish();
    }, 1000);
  }, 1500);

  // Absolute cap.
  setTimeout(() => {
    if (finalized) return;
    recordFailure("TIMEOUT", `Total timeout exceeded (${totalTimeoutMs}ms)`);
    finalize(false, "timeout");
  }, totalTimeoutMs + 250);

  console.log("E2E: running two-bot harness");
  console.log("  coordinator:", coordinatorUrl);
  console.log("  botA:", botA.agentId, "botB:", botB.agentId);
  console.log("  report:", reportPath);
}

main();

