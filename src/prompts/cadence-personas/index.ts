/**
 * Cadence persona loader: reads persona JSON files from personas/ and exposes
 * them for use by a cadence post-processor (LLM → markup → SSML → TTS).
 *
 * Usage: set PERSONA_CADENCE_PROFILE in env (e.g. orator_v1, podcast_host_v1)
 * or pass persona id (orator, podcast_host, bold_host, storyteller, pundit)
 * to getCadencePersona().
 */

import * as fs from "fs";
import * as path from "path";
import type { CadencePersonaSpec } from "./types";

const PERSONAS_DIR = path.resolve(process.cwd(), "personas");
const BUILTIN_IDS = ["orator", "podcast_host", "bold_host", "storyteller", "pundit"] as const;

let cache: Map<string, CadencePersonaSpec> | null = null;

function loadPersonasDir(): Map<string, CadencePersonaSpec> {
  if (cache) return cache;
  cache = new Map();
  if (!fs.existsSync(PERSONAS_DIR)) return cache;
  for (const id of BUILTIN_IDS) {
    const p = path.join(PERSONAS_DIR, `${id}.json`);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const spec = JSON.parse(raw) as CadencePersonaSpec;
      spec.id = spec.id || id;
      cache.set(id, spec);
    } catch {
      // Skip invalid or unreadable files
    }
  }
  return cache;
}

/**
 * Returns the cadence persona spec for the given id (e.g. orator, podcast_host).
 * Also matches profile names that include a version suffix (e.g. orator_v1).
 */
export function getCadencePersona(idOrProfile?: string): CadencePersonaSpec | null {
  if (!idOrProfile?.trim()) return null;
  const key = idOrProfile.trim().toLowerCase();
  const map = loadPersonasDir();
  if (map.has(key)) return map.get(key) ?? null;
  const baseId = key.replace(/_v\d+$/, "");
  return map.get(baseId) ?? null;
}

/**
 * Returns all loaded cadence persona ids.
 */
export function getCadencePersonaIds(): string[] {
  return Array.from(loadPersonasDir().keys());
}

export type { CadencePersonaSpec, CadenceConfigEnv, SSMLDefaults, WritingGuidelines } from "./types";
