"use strict";
/**
 * Cadence persona loader: reads persona JSON files from personas/ and exposes
 * them for use by a cadence post-processor (LLM → markup → SSML → TTS).
 *
 * Usage: set PERSONA_CADENCE_PROFILE in env (e.g. orator_v1, podcast_host_v1)
 * or pass persona id (orator, podcast_host, bold_host, storyteller, pundit)
 * to getCadencePersona().
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCadencePersona = getCadencePersona;
exports.getCadencePersonaIds = getCadencePersonaIds;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PERSONAS_DIR = path.resolve(process.cwd(), "personas");
const BUILTIN_IDS = ["orator", "podcast_host", "bold_host", "storyteller", "pundit"];
let cache = null;
function loadPersonasDir() {
    if (cache)
        return cache;
    cache = new Map();
    if (!fs.existsSync(PERSONAS_DIR))
        return cache;
    for (const id of BUILTIN_IDS) {
        const p = path.join(PERSONAS_DIR, `${id}.json`);
        if (!fs.existsSync(p))
            continue;
        try {
            const raw = fs.readFileSync(p, "utf-8");
            const spec = JSON.parse(raw);
            spec.id = spec.id || id;
            cache.set(id, spec);
        }
        catch {
            // Skip invalid or unreadable files
        }
    }
    return cache;
}
/**
 * Returns the cadence persona spec for the given id (e.g. orator, podcast_host).
 * Also matches profile names that include a version suffix (e.g. orator_v1).
 */
function getCadencePersona(idOrProfile) {
    if (!idOrProfile?.trim())
        return null;
    const key = idOrProfile.trim().toLowerCase();
    const map = loadPersonasDir();
    if (map.has(key))
        return map.get(key) ?? null;
    const baseId = key.replace(/_v\d+$/, "");
    return map.get(baseId) ?? null;
}
/**
 * Returns all loaded cadence persona ids.
 */
function getCadencePersonaIds() {
    return Array.from(loadPersonasDir().keys());
}
//# sourceMappingURL=index.js.map