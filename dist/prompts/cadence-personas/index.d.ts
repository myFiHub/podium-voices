/**
 * Cadence persona loader: reads persona JSON files from personas/ and exposes
 * them for use by a cadence post-processor (LLM → markup → SSML → TTS).
 *
 * Usage: set PERSONA_CADENCE_PROFILE in env (e.g. orator_v1, podcast_host_v1)
 * or pass persona id (orator, podcast_host, bold_host, storyteller, pundit)
 * to getCadencePersona().
 */
import type { CadencePersonaSpec } from "./types";
/**
 * Returns the cadence persona spec for the given id (e.g. orator, podcast_host).
 * Also matches profile names that include a version suffix (e.g. orator_v1).
 */
export declare function getCadencePersona(idOrProfile?: string): CadencePersonaSpec | null;
/**
 * Returns all loaded cadence persona ids.
 */
export declare function getCadencePersonaIds(): string[];
export type { CadencePersonaSpec, CadenceConfigEnv, SSMLDefaults, WritingGuidelines } from "./types";
//# sourceMappingURL=index.d.ts.map