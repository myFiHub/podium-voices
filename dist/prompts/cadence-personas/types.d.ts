/**
 * Cadence persona spec: a bundle of controllable variables across script,
 * prosody markup, and TTS voice parameters so cadence is consistent per persona.
 *
 * Use with: LLM rewrite pass (cadence marks) → post-processor (to SSML) → TTS.
 */
/** Target words-per-minute ranges. */
export interface WpmTargets {
    /** Baseline WPM for normal content. */
    baseline: {
        min: number;
        max: number;
    };
    /** Stakes / weighty lines: slower. */
    stakes: {
        min: number;
        max: number;
    };
    /** Connective tissue / transitions: slightly faster. */
    connective: {
        min: number;
        max: number;
    };
}
/** Pause durations in ms. */
export interface PauseTiers {
    /** Comma / clause boundary. */
    commaMs: {
        min: number;
        max: number;
    };
    /** Sentence end (period). */
    periodMs: {
        min: number;
        max: number;
    };
    /** Paragraph / topic shift. */
    paragraphMs: {
        min: number;
        max: number;
    };
    /** Lead-in before an emphasized key clause. */
    emphasisLeadInMs: {
        min: number;
        max: number;
    };
}
/** Overall pause budget: fraction of total time that is silence (0–1). */
export interface PauseBudget {
    /** Target pause percentage of total time (e.g. 0.12–0.22). */
    targetFraction: {
        min: number;
        max: number;
    };
}
/** Phrase and emphasis targets. */
export interface PhraseAndEmphasis {
    /** Words per clause (target range). */
    wordsPerClause: {
        min: number;
        max: number;
    };
    /** One emphasized word per N words (e.g. 10–18). */
    emphasisPerWords: number;
}
/** Intonation description for tuning (narrow/wide pitch, rise/fall). */
export interface IntonationPattern {
    /** e.g. "narrow pitch range, controlled rise on rhetorical questions, gentle fall at line ends". */
    description: string;
    /** SSML prosody pitch offset (e.g. "-2%"). */
    pitchPercent?: number;
}
/** Style contract: measurable targets for calibration. */
export interface CadenceStyleContract {
    wpm: WpmTargets;
    pauseBudget: PauseBudget;
    pauseTiers: PauseTiers;
    phraseAndEmphasis: PhraseAndEmphasis;
    intonation: IntonationPattern;
}
/** Writing guidelines so the LLM (and rewrite pass) produce cadence-friendly text. */
export interface WritingGuidelines {
    /** Short summary for system prompt. */
    summary: string;
    /** Sentence architecture: clause length, punctuation, parallelism. */
    sentenceArchitecture: string[];
    /** What to prefer (e.g. "we", "our", triads, setup→pause→punchline). */
    prefer: string[];
    /** What to avoid (e.g. meme slang, dense subordinate clauses). */
    avoid: string[];
}
/** Internal cadence markup (before SSML). Example: [p350], *emphasis*. */
export interface CadenceMarkupExample {
    /** Human-readable description. */
    description: string;
    /** Example line with markup. */
    example: string;
    /** Corresponding SSML snippet (optional). */
    ssmlSnippet?: string;
}
/** SSML defaults for this persona (prosody rate, pitch; break patterns). */
export interface SSMLDefaults {
    /** Prosody rate multiplier (e.g. 0.92 = 92%). */
    ratePercent: number;
    /** Prosody pitch offset (e.g. -2). */
    pitchPercent: number;
    /** Emphasis level: "none" | "reduced" | "moderate" | "strong". */
    emphasisLevel: "moderate" | "strong" | "reduced" | "none";
    /** Example SSML fragment that embodies the persona. */
    exampleFragment: string;
}
/** Voice characteristics (for voice selection and TTS tuning). */
export interface VoiceCharacteristics {
    /** Low / mid / high. */
    pitchRange: string;
    /** e.g. "clean articulation", "controlled expressiveness". */
    traits: string[];
    /** Tuning: stability (composed vs expressive). */
    stability: "high" | "medium" | "low";
    /** Style/exaggeration: lower = more composed. */
    styleExaggeration: "low" | "medium" | "high";
    /**
     * Google Cloud TTS voice name (e.g. en-US-Neural2-D, en-US-Wavenet-F).
     * When set, PERSONA_ID/cadence profile drives both prosody and voice identity.
     * See docs/GOOGLE_TTS_VOICES for supported names.
     */
    googleVoiceName?: string;
}
/** Config-style key-value pairs for pipeline/env (e.g. PERSONA_CADENCE_PROFILE, ORATOR_RATE). */
export interface CadenceConfigEnv {
    [key: string]: string | number;
}
/**
 * Full cadence persona: style contract, writing guidelines, markup/SSML, voice, and config.
 */
export interface CadencePersonaSpec {
    id: string;
    name: string;
    /** Inspiration vibe (no real names required); e.g. "measured, presidential, inspirational orator". */
    inspiration: string;
    /** Style contract: measurable targets. */
    styleContract: CadenceStyleContract;
    /** How to write for this cadence. */
    writingGuidelines: WritingGuidelines;
    /** Cadence markup convention and SSML example. */
    cadenceMarkup: CadenceMarkupExample[];
    /** Default SSML prosody and break pattern. */
    ssmlDefaults: SSMLDefaults;
    /** Voice selection and TTS tuning hints. */
    voice: VoiceCharacteristics;
    /** Env-style config for this persona (rate, pause ms, emphasis per words, etc.). */
    config: CadenceConfigEnv;
}
//# sourceMappingURL=types.d.ts.map